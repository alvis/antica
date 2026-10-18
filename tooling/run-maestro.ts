import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { SpawnSyncReturns } from 'node:child_process';

/** interface languages a journey run can select through the app's development link */
export const journeyLocales = ['en', 'zh-Hant', 'zh-Hans'] as const;

/** interface language the journeys run in */
export type JourneyLocale = (typeof journeyLocales)[number];

/** interface language of a fresh install, and of a run that names none */
export const defaultJourneyLocale: JourneyLocale = 'zh-Hant';

/** settings for one local Maestro journey run against the emulator */
export interface MaestroRun {
  /** Android application ID installed on the emulator */
  appId: string;
  /** interface language flow 01 saves before signing in; later flows keep it */
  locale: JourneyLocale;
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
 * reads the journey language from the environment, defaulting to the app's own default
 * @param value requested language tag, if any
 * @returns the supported journey language
 * @throws {Error} when the value names an unsupported language
 */
export function journeyLocale(value: string | undefined): JourneyLocale {
  const locale = value ?? defaultJourneyLocale;
  const supported = journeyLocales.find((candidate) => candidate === locale);
  if (!supported) {
    throw new Error(
      `Unsupported journey locale ${locale}; use one of ${journeyLocales.join(', ')}.`,
    );
  }

  return supported;
}

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
 * chooses the values flow 07 types, in the run's interface language
 * @param locale interface language of the run
 * @param stamp run timestamp that keeps the edited name unique
 * @returns the name, height in millimetres, and both location fields to enter
 */
export function recordEditValues(
  locale: JourneyLocale,
  stamp: string,
): Record<string, string> {
  const english = locale === 'en';

  return {
    EDITED_NAME: english ? `Celadon bowl ${stamp}` : `清代青瓷碗 ${stamp}`,
    HEIGHT: '125',
    LOCATION: english ? 'Main display-room cabinet' : '主陳列室玻璃櫃',
    LOCATION_DETAIL: english
      ? 'Upper-right corner of the second shelf'
      : '第二層右上角',
  };
}

/**
 * runs flow 06 in two stages around a newly issued code: language choices before sign-in, then after it
 * @param run app, phone, inbox and flow locations of this run
 * @param io process, file and clock effects
 */
export function runLanguageSettingsJourney(
  run: MaestroRun,
  io: RunnerIO,
): void {
  const flowPath = resolve(run.flowDirectory, '06-language-settings.yaml');
  const requestedAt = io.now();
  io.run(
    maestroStep(run.deviceId, flowPath, {
      APP_ID: run.appId,
      STAGE: 'pre-login',
      PHONE_NUMBER: run.phoneNumber,
    }),
  );
  const otpCode = latestOtp(io.readText(run.otpInboxPath), {
    phoneNumber: run.phoneNumber,
    since: requestedAt,
    source: run.otpInboxPath,
  });
  io.run(
    maestroStep(run.deviceId, flowPath, {
      APP_ID: run.appId,
      STAGE: 'signed-in',
      OTP_CODE: otpCode,
    }),
  );
}

/**
 * runs journeys 01–05 and 07–09 in one interface language: request a code, sign in, import and reopen, camera capture, record messages, manual record editing, a labelled set from the in-app camera, then an upload resumed after the app closed; a run in the default language then adds flow 06
 * @param run journey settings
 * @param io side effects
 */
export function runMaestroJourneys(run: MaestroRun, io: RunnerIO): void {
  const flow = (name: string): string => resolve(run.flowDirectory, name);
  const requestedAt = io.now();
  const stamp = requestedAt.toISOString().slice(0, secondsTimestampLength);
  // the name 05 gives the camera record, by which 07 opens it
  const renamed = `青瓷碗 ${stamp}`;
  io.run(
    maestroStep(run.deviceId, flow('01-request-code.yaml'), {
      APP_ID: run.appId,
      APP_LOCALE: run.locale,
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
      APP_LOCALE: run.locale,
      RECORD_NAME: `Camera ${stamp}`,
      NEW_NAME: renamed,
      NEW_PERIOD: '清代',
    }),
  );
  // edits the same record by hand, now named by 05, and reopens the editor
  io.run(
    maestroStep(run.deviceId, flow('07-record-edit.yaml'), {
      APP_ID: run.appId,
      RECORD_NAME: renamed,
      ...recordEditValues(run.locale, stamp),
    }),
  );
  // photographs a set six times in the in-app camera and labels its components (PT-3)
  io.run(
    maestroStep(run.deviceId, flow('08-capture-set.yaml'), {
      APP_ID: run.appId,
      RECORD_NAME: `Set ${stamp}`,
    }),
  );
  // closes the app with photos unsaved, resumes from the restart prompt, and counts no duplicate (PT-5)
  io.run(
    maestroStep(run.deviceId, flow('09-upload-resume.yaml'), {
      APP_ID: run.appId,
    }),
  );
  // flow 06 clears state, so a fresh install starts in the default language
  if (run.locale === defaultJourneyLocale) {
    runLanguageSettingsJourney(run, io);
  }
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
        locale: journeyLocale(process.env.ANTICA_E2E_LOCALE),
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
