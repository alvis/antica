import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { SpawnSyncReturns } from 'node:child_process';

/** settings for one local Maestro journey run against the emulator */
export interface MaestroRun {
  /** Android application ID installed on the emulator */
  appId: string;
  /** collector phone number allowed by the development API */
  phoneNumber: string;
  /** development OTP inbox written by the local API */
  otpInboxPath: string;
  /** host image pushed into the emulator gallery for the import step */
  sampleImagePath: string;
  /** text or accessibility-label pattern of the photo-picker thumbnail to tap */
  mediaPickerItem: string;
  /** directory containing the numbered Maestro flows */
  flowDirectory: string;
  /** adb serial of the target device; adb and Maestro pick the only device when absent */
  deviceId?: string;
}

/** one Maestro or adb invocation in execution order */
export interface RunStep {
  /** executable resolved from PATH */
  command: string;
  /** arguments passed verbatim to the executable */
  args: string[];
}

/** side effects the journey runner needs, injectable for tests */
export interface RunnerIO {
  /** runs a step with inherited output and throws when it fails */
  run: (step: RunStep) => void;
  /** runs a step and returns its standard output, throwing when it fails */
  capture: (step: RunStep) => string;
  /** reads a UTF-8 text file */
  readText: (path: string) => string;
  /** returns the current time */
  now: () => Date;
  /** blocks for the given number of milliseconds */
  pause: (milliseconds: number) => void;
}

const mediaStoreImages = 'content://media/external/images/media';

/** length of an ISO timestamp truncated to whole seconds, e.g. 2026-10-16T10:00:00 */
const secondsTimestampLength = 19;

/** attempts and spacing while waiting for the media scanner to index the sample */
const galleryIndexPolling = { attempts: 10, intervalMs: 500 } as const;

/**
 * selects the newest development OTP issued to a phone after a start time
 * @param inbox JSON-lines content of the development OTP inbox
 * @param query which codes qualify and where they came from
 * @param query.phoneNumber collector phone number
 * @param query.since only codes created at or after this instant qualify
 * @param query.source inbox path named in error messages
 * @returns the newest matching six-digit code
 */
export function latestOtp(
  inbox: string,
  query: { phoneNumber: string; since: Date; source: string },
): string {
  const { phoneNumber, since, source } = query;
  const codes = inbox
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => line.trim().length > 0)
    .map(({ line, number }) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch (cause) {
        throw new Error(`Malformed OTP inbox entry at ${source}:${number}.`, {
          cause,
        });
      }
    })
    .filter(
      (entry) =>
        entry.phoneNumber === phoneNumber &&
        typeof entry.code === 'string' &&
        typeof entry.createdAt === 'string' &&
        Date.parse(entry.createdAt) >= since.getTime(),
    )
    .sort(
      (left, right) =>
        Date.parse(String(left.createdAt)) -
        Date.parse(String(right.createdAt)),
    );
  const code = codes.at(-1)?.code;
  if (typeof code !== 'string') {
    throw new Error(
      `No development OTP was issued to ${phoneNumber} in ${source}.`,
    );
  }

  return code;
}

/**
 * builds an adb invocation, targeting a device only when one is named
 * @param deviceId adb serial, if any
 * @param args adb arguments after the device selector
 * @returns the adb command step
 */
export function adbStep(deviceId: string | undefined, args: string[]): RunStep {
  return {
    command: 'adb',
    args: deviceId ? ['-s', deviceId, ...args] : args,
  };
}

/**
 * builds a Maestro invocation with flow variables passed as environment flags
 * @param deviceId adb serial of the target Android device, if any
 * @param flowPath absolute Maestro flow path
 * @param variables flow variables
 * @returns the maestro command step
 */
export function maestroStep(
  deviceId: string | undefined,
  flowPath: string,
  variables: Readonly<Record<string, string>>,
): RunStep {
  return {
    command: 'maestro',
    args: [
      '--platform=android',
      ...(deviceId ? [`--device=${deviceId}`] : []),
      'test',
      ...Object.entries(variables).flatMap(([name, value]) => [
        '-e',
        `${name}=${value}`,
      ]),
      flowPath,
    ],
  };
}

/**
 * builds the adb steps that leave the sample as the only gallery image
 * @param deviceId adb serial of the target Android device, if any
 * @param sampleImagePath host image path
 * @returns clear, push and media-scan steps
 */
export function seedGallerySteps(
  deviceId: string | undefined,
  sampleImagePath: string,
): RunStep[] {
  const galleryPath = `/sdcard/Pictures/${basename(sampleImagePath)}`;

  return [
    // the test AVD is dedicated to E2E; deleting MediaStore images also deletes their files
    adbStep(deviceId, [
      'shell',
      'content',
      'delete',
      '--uri',
      mediaStoreImages,
    ]),
    adbStep(deviceId, ['push', sampleImagePath, galleryPath]),
    adbStep(deviceId, [
      'shell',
      'am',
      'broadcast',
      '-a',
      'android.intent.action.MEDIA_SCANNER_SCAN_FILE',
      '-d',
      `file://${galleryPath}`,
    ]),
  ];
}

/**
 * waits until the media scanner has indexed the sample, so the picker can show it
 * @param io side effects
 * @param deviceId adb serial of the target Android device, if any
 * @param fileName display name the sample must appear under
 */
export function waitForGalleryIndex(
  io: RunnerIO,
  deviceId: string | undefined,
  fileName: string,
): void {
  const query = adbStep(deviceId, [
    'shell',
    'content',
    'query',
    '--uri',
    mediaStoreImages,
    '--projection',
    '_display_name',
  ]);
  for (let attempt = 1; attempt <= galleryIndexPolling.attempts; attempt++) {
    if (io.capture(query).includes(`_display_name=${fileName}`)) {
      return;
    }
    io.pause(galleryIndexPolling.intervalMs);
  }
  throw new Error(`The media scanner did not index ${fileName}.`);
}

/**
 * runs journeys 01–05: request a code, sign in, import and reopen, camera capture, then record messages
 * @param run journey settings
 * @param io side effects
 */
export function runMaestroJourneys(run: MaestroRun, io: RunnerIO): void {
  const flow = (name: string): string => resolve(run.flowDirectory, name);
  const requestedAt = io.now();
  const stamp = requestedAt.toISOString().slice(0, secondsTimestampLength);
  io.run(
    maestroStep(run.deviceId, flow('01-request-code.yaml'), {
      APP_ID: run.appId,
      PHONE_NUMBER: run.phoneNumber,
    }),
  );
  const otpCode = latestOtp(io.readText(run.otpInboxPath), {
    phoneNumber: run.phoneNumber,
    since: requestedAt,
    source: run.otpInboxPath,
  });
  io.run(
    maestroStep(run.deviceId, flow('02-authenticate.yaml'), {
      APP_ID: run.appId,
      OTP_CODE: otpCode,
    }),
  );
  seedGallerySteps(run.deviceId, run.sampleImagePath).forEach(io.run);
  waitForGalleryIndex(io, run.deviceId, basename(run.sampleImagePath));
  io.run(
    maestroStep(run.deviceId, flow('03-capture-reopen.yaml'), {
      APP_ID: run.appId,
      MEDIA_PICKER_ITEM: run.mediaPickerItem,
      ORIGINAL_WORDS: 'Celadon glaze with fine crackle',
      RECORD_NAME: `E2E ${stamp}`,
    }),
  );
  io.run(
    maestroStep(run.deviceId, flow('04-camera-capture.yaml'), {
      APP_ID: run.appId,
      RECORD_NAME: `Camera ${stamp}`,
    }),
  );
  // talks to the assistant about the camera record from 04 and edits it through a card
  io.run(
    maestroStep(run.deviceId, flow('05-record-messages.yaml'), {
      APP_ID: run.appId,
      RECORD_NAME: `Camera ${stamp}`,
      NEW_NAME: `青瓷碗 ${stamp}`,
      NEW_PERIOD: '清代',
    }),
  );
}

/**
 * spawns a step synchronously and surfaces spawn errors and non-zero exits
 * @param step command to execute
 * @param stdio inherit output for visibility or pipe it back to the caller
 * @returns the completed process result
 */
function spawnStep(
  step: RunStep,
  stdio: 'inherit' | 'pipe',
): SpawnSyncReturns<string> {
  const result = spawnSync(step.command, step.args, {
    stdio,
    encoding: 'utf8',
  });
  const command = `${step.command} ${step.args.join(' ')}`;
  if (result.error) {
    throw new Error(`${command} could not start.`, { cause: result.error });
  }
  if (result.status !== 0) {
    // piped stderr explains the failure; inherited output is already on screen
    const detail = stdio === 'pipe' ? `: ${result.stderr.trim()}` : '';
    throw new Error(
      `${command} exited with ${result.status ?? result.signal}${detail}`,
    );
  }

  return result;
}

/** process-backed side effects for command-line use */
const processIO: RunnerIO = {
  run: (step) => void spawnStep(step, 'inherit'),
  capture: (step) => spawnStep(step, 'pipe').stdout,
  readText: (path) => readFileSync(path, 'utf8'),
  now: () => new Date(),
  pause: (milliseconds) =>
    void Atomics.wait(
      new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
      0,
      0,
      milliseconds,
    ),
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const sampleImagePath = process.argv[2];
  if (!sampleImagePath) {
    process.stderr.write('Usage: run-maestro.ts <sample-image.jpg>\n');
    process.exitCode = 2;
  } else {
    runMaestroJourneys(
      {
        appId: process.env.APP_ID ?? 'app.antica.collector',
        phoneNumber: process.env.ANTICA_COLLECTOR_PHONE ?? '+15550100001',
        otpInboxPath: resolve(
          root,
          'apps/api',
          process.env.ANTICA_DEV_OTP_INBOX ?? '.antica-dev/otp-inbox.jsonl',
        ),
        sampleImagePath: resolve(sampleImagePath),
        // the Android photo picker labels thumbnails in the emulator's system language (English)
        mediaPickerItem: process.env.MEDIA_PICKER_ITEM ?? 'Photo taken on .*',
        flowDirectory: resolve(root, 'apps/mobile/e2e'),
        deviceId: process.env.ANDROID_SERIAL,
      },
      processIO,
    );
  }
}
