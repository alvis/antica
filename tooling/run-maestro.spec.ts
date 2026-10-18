import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  adbStep,
  journeyLocale,
  latestOtp,
  maestroStep,
  runMaestroJourneys,
  seedGallerySteps,
  waitForGalleryIndex,
} from './run-maestro.ts';

import type { MaestroRun, RunStep, RunnerIO } from './run-maestro.ts';

const phone = '+15550100001';
const source = 'inbox.jsonl';
const since = new Date('2026-10-16T09:00:00.000Z');

/**
 * encodes development OTP inbox entries as JSON lines
 * @param entries inbox records
 * @returns JSON-lines inbox content
 */
function inbox(...entries: Array<Record<string, unknown>>): string {
  return `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
}

/**
 * creates recording side effects for the journey runner
 * @param overrides behaviour to replace
 * @returns the fake IO, the steps it ran in order, and the pauses it took
 */
function recordingIO(overrides: Partial<RunnerIO> = {}): {
  io: RunnerIO;
  ran: RunStep[];
  pauses: number[];
} {
  const ran: RunStep[] = [];
  const pauses: number[] = [];

  return {
    ran,
    pauses,
    io: {
      run: (step) => void ran.push(step),
      capture: () => 'Row: 0 _display_name=sample.jpg',
      readText: () =>
        inbox({
          phoneNumber: phone,
          code: '424242',
          createdAt: '2026-10-16T10:00:00.000Z',
        }),
      now: () => new Date('2026-10-16T10:00:00.000Z'),
      pause: (milliseconds) => void pauses.push(milliseconds),
      ...overrides,
    },
  };
}

const run: MaestroRun = {
  appId: 'app.id',
  locale: 'zh-Hant',
  phoneNumber: phone,
  otpInboxPath: '/api/inbox.jsonl',
  sampleImagePath: '/fixtures/sample.jpg',
  mediaPickerItem: 'Photo taken on .*',
  flowDirectory: '/e2e',
  deviceId: 'emulator-5554',
};

void describe('fn:latestOtp', () => {
  void it('should return the newest code for the phone when several were issued', () => {
    const content = inbox(
      { phoneNumber: phone, code: '111111', createdAt: '2026-10-16T10:00:00Z' },
      { phoneNumber: phone, code: '333333', createdAt: '2026-10-16T10:02:00Z' },
      { phoneNumber: phone, code: '222222', createdAt: '2026-10-16T10:01:00Z' },
    );

    assert.equal(
      latestOtp(content, { phoneNumber: phone, since, source }),
      '333333',
    );
  });

  void it('should accept a code issued exactly at the start instant', () => {
    const content = inbox({
      phoneNumber: phone,
      code: '555555',
      createdAt: since.toISOString(),
    });

    assert.equal(
      latestOtp(content, { phoneNumber: phone, since, source }),
      '555555',
    );
  });

  void it('should ignore codes for other phones, earlier codes, and malformed timestamps', () => {
    const content = inbox(
      { phoneNumber: phone, code: '111111', createdAt: '2026-10-16T08:00:00Z' },
      { phoneNumber: phone, code: '777777', createdAt: 'not a date' },
      {
        phoneNumber: '+15550100002',
        code: '999999',
        createdAt: '2026-10-16T10:00:00Z',
      },
      { phoneNumber: phone, code: '222222', createdAt: '2026-10-16T10:00:00Z' },
    );

    assert.equal(
      latestOtp(content, { phoneNumber: phone, since, source }),
      '222222',
    );
  });

  void it('should name the inbox when no qualifying code exists', () => {
    const content = inbox({
      phoneNumber: phone,
      code: '111111',
      createdAt: '2026-10-16T08:00:00Z',
    });

    assert.throws(
      () => latestOtp(content, { phoneNumber: phone, since, source }),
      /No development OTP was issued to \+15550100001 in inbox\.jsonl/,
    );
  });

  void it('should name the file and line of a malformed entry', () => {
    const content = `${inbox({ phoneNumber: phone, code: '1', createdAt: '2026-10-16T10:00:00Z' })}{"phoneNumber":`;

    assert.throws(
      () => latestOtp(content, { phoneNumber: phone, since, source }),
      /Malformed OTP inbox entry at inbox\.jsonl:2/,
    );
  });
});

void describe('fn:journeyLocale', () => {
  void it('should run in Traditional Chinese unless another language is requested', () => {
    assert.equal(journeyLocale(undefined), 'zh-Hant');
    assert.equal(journeyLocale('en'), 'en');
    assert.equal(journeyLocale('zh-Hans'), 'zh-Hans');
  });

  void it('should reject a language the app does not offer', () => {
    assert.throws(
      () => journeyLocale('fr'),
      /Unsupported journey locale fr; use one of en, zh-Hant, zh-Hans\./,
    );
  });
});

void describe('fn:adbStep', () => {
  void it('should target the named device', () => {
    assert.deepEqual(adbStep('emulator-5556', ['devices']).args, [
      '-s',
      'emulator-5556',
      'devices',
    ]);
  });

  void it('should leave device selection to adb when no device is named', () => {
    assert.deepEqual(adbStep(undefined, ['devices']).args, ['devices']);
  });
});

void describe('fn:maestroStep', () => {
  void it('should pin the device and pass each flow variable before the flow', () => {
    assert.deepEqual(
      maestroStep('emulator-5554', '/e2e/01.yaml', {
        APP_ID: 'app.id',
        PHONE_NUMBER: phone,
      }),
      {
        command: 'maestro',
        args: [
          '--platform=android',
          '--device=emulator-5554',
          'test',
          '-e',
          'APP_ID=app.id',
          '-e',
          `PHONE_NUMBER=${phone}`,
          '/e2e/01.yaml',
        ],
      },
    );
  });

  void it('should omit the device flag when no device is named', () => {
    assert.deepEqual(maestroStep(undefined, '/e2e/01.yaml', {}).args, [
      '--platform=android',
      'test',
      '/e2e/01.yaml',
    ]);
  });
});

void describe('fn:seedGallerySteps', () => {
  void it('should clear the gallery, then push and scan the sample under its own name', () => {
    const [clear, push, scan] = seedGallerySteps(
      'emulator-5554',
      '/fixtures/sample.jpg',
    );

    assert.deepEqual(clear.args.slice(2), [
      'shell',
      'content',
      'delete',
      '--uri',
      'content://media/external/images/media',
    ]);
    assert.deepEqual(push.args, [
      '-s',
      'emulator-5554',
      'push',
      '/fixtures/sample.jpg',
      '/sdcard/Pictures/sample.jpg',
    ]);
    assert.equal(scan.args.at(-1), 'file:///sdcard/Pictures/sample.jpg');
  });
});

void describe('fn:waitForGalleryIndex', () => {
  void it('should return once the sample appears in the media store', () => {
    const outputs = ['No result found.', 'Row: 0 _display_name=sample.jpg'];
    const { io, pauses } = recordingIO({
      capture: () => outputs.shift() ?? '',
    });

    waitForGalleryIndex(io, undefined, 'sample.jpg');

    assert.deepEqual(pauses, [500]);
  });

  void it('should fail when the scanner never indexes the sample', () => {
    const { io, pauses } = recordingIO({ capture: () => 'No result found.' });

    assert.throws(
      () => waitForGalleryIndex(io, undefined, 'sample.jpg'),
      /The media scanner did not index sample\.jpg/,
    );
    assert.equal(pauses.length, 10);
  });
});

void describe('fn:runMaestroJourneys', () => {
  void it('should sign in with the issued code, seed the gallery, then run imports, camera capture and record messages', () => {
    const { io, ran } = recordingIO();

    runMaestroJourneys({ ...run, locale: 'en' }, io);

    assert.deepEqual(
      ran.map((step) => `${step.command} ${step.args.at(-1)}`),
      [
        'maestro /e2e/01-request-code.yaml',
        'maestro /e2e/02-authenticate.yaml',
        'adb content://media/external/images/media',
        'adb /sdcard/Pictures/sample.jpg',
        'adb file:///sdcard/Pictures/sample.jpg',
        'maestro /e2e/03-capture-reopen.yaml',
        'maestro /e2e/04-camera-capture.yaml',
        'maestro /e2e/05-record-messages.yaml',
      ],
    );
    assert.ok(ran[0]?.args.includes('APP_LOCALE=en'));
    assert.ok(ran[1]?.args.includes('OTP_CODE=424242'));
    assert.ok(ran[5]?.args.includes('RECORD_NAME=E2E 2026-10-16T10:00:00'));
    assert.ok(ran[6]?.args.includes('RECORD_NAME=Camera 2026-10-16T10:00:00'));
    assert.ok(ran[7]?.args.includes('RECORD_NAME=Camera 2026-10-16T10:00:00'));
    assert.ok(ran[7]?.args.includes('NEW_NAME=青瓷碗 2026-10-16T10:00:00'));
    assert.ok(ran[7]?.args.includes('NEW_PERIOD=清代'));
    assert.ok(ran[7]?.args.includes('APP_LOCALE=en'));
  });

  void it('should add the language-settings flow around a second code in the default language', () => {
    const codes = ['111111', '222222'];
    const { io, ran } = recordingIO({
      readText: () =>
        inbox({
          phoneNumber: phone,
          code: codes.shift(),
          createdAt: '2026-10-16T10:00:00.000Z',
        }),
    });

    runMaestroJourneys(run, io);

    assert.deepEqual(
      ran.slice(7).map((step) => step.args.slice(3)),
      [
        [
          '-e',
          'APP_ID=app.id',
          '-e',
          'APP_LOCALE=zh-Hant',
          '-e',
          'RECORD_NAME=Camera 2026-10-16T10:00:00',
          '-e',
          'NEW_NAME=青瓷碗 2026-10-16T10:00:00',
          '-e',
          'NEW_PERIOD=清代',
          '/e2e/05-record-messages.yaml',
        ],
        [
          '-e',
          'APP_ID=app.id',
          '-e',
          'STAGE=pre-login',
          '-e',
          `PHONE_NUMBER=${phone}`,
          '/e2e/06-language-settings.yaml',
        ],
        [
          '-e',
          'APP_ID=app.id',
          '-e',
          'STAGE=signed-in',
          '-e',
          'OTP_CODE=222222',
          '/e2e/06-language-settings.yaml',
        ],
      ],
    );
    assert.ok(ran[1]?.args.includes('OTP_CODE=111111'));
  });

  void it('should stop before authenticating when no code was issued during the run', () => {
    const { io, ran } = recordingIO({ readText: () => '' });

    assert.throws(() => runMaestroJourneys(run, io), /No development OTP/);
    assert.equal(ran.length, 1);
  });
});

void describe('cli:run-maestro', () => {
  void it('should print usage and exit with 2 when the sample image is missing', () => {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./run-maestro.ts', import.meta.url))],
      { encoding: 'utf8' },
    );

    assert.equal(result.status, 2);
    assert.match(result.stderr, /Usage: run-maestro\.ts <sample-image\.jpg>/);
  });
});
