import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

import { z } from 'zod';

import {
  mediaCompletionSchema,
  mediaDetailSchema,
  uploadSessionSchema,
} from '@antica/contracts';

import type { MediaDetail, MediaPurpose } from '@antica/contracts';

/** where the demo seed reaches the running API and its development OTP inbox */
export interface DemoApiParams {
  /** API origin reachable from this host, e.g. http://127.0.0.1:8096 */
  readonly origin: string;
  readonly phoneNumber: string;
  /** JSON-lines inbox the development OTP driver appends to */
  readonly inboxPath: string;
}

/** one photo or receipt to send through the upload pipeline */
export interface DemoUpload {
  readonly recordId: string;
  readonly purpose: Extract<MediaPurpose, 'object' | 'receipt' | 'voice_note'>;
  readonly fileName: string;
  readonly bytes: Buffer;
}

/** method and JSON body of a non-GET request */
export interface DemoRequestInit {
  readonly method: 'POST' | 'PATCH';
  readonly body: unknown;
}

/** sends a JSON request as the demo owner and parses the successful body with the contract */
export type DemoRequest = <T extends z.ZodType>(
  path: string,
  schema: T,
  init?: DemoRequestInit,
) => Promise<z.infer<T>>;

/** authenticated JSON calls against the shipped API as the demo owner */
export interface DemoApi {
  readonly request: DemoRequest;
  /** fetches a URL minted by the API as the host sees it */
  readonly fetchMinted: (url: string, init?: RequestInit) => Promise<Response>;
  /** uploads bytes and completes the upload; processing continues in the jobs drain */
  readonly upload: (input: DemoUpload) => Promise<string>;
  /** waits until the jobs drain marks the assets ready */
  readonly waitUntilReady: (
    assetIds: readonly string[],
  ) => Promise<readonly MediaDetail[]>;
}

const otpEntrySchema = z.object({
  phoneNumber: z.string(),
  code: z.string(),
  createdAt: z.string(),
});
const readyPollIntervalMs = 1000;
const readyTimeoutMs = 180_000;
const otpPollIntervalMs = 250;
const otpWaitMs = 5000;

/**
 * signs the demo owner in through the development OTP inbox
 * @param params API origin, owner phone and OTP inbox
 * @returns JSON and upload calls carrying the session cookie
 */
export async function connectDemoApi(params: DemoApiParams): Promise<DemoApi> {
  const cookie = await signIn(params);
  const fetchMinted = async (
    url: string,
    init?: RequestInit,
  ): Promise<Response> => fetch(rebaseOrigin(url, params.origin), init);
  const request: DemoRequest = async (path, schema, init) => {
    const response = await fetch(`${params.origin}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        cookie,
        'content-type': 'application/json',
        'idempotency-key': requestKeyOf(init?.body),
      },
      body: init ? JSON.stringify(init.body) : undefined,
    });

    return schema.parse(
      await readSuccess(response, `${init?.method ?? 'GET'} ${path}`),
    );
  };

  return {
    request,
    fetchMinted,
    upload: async (input) => uploadMedia({ request, fetchMinted }, input),
    waitUntilReady: async (assetIds) => waitForMedia(request, assetIds),
  };
}

/**
 * replaces the public origin the API signs URLs with by the origin this host uses
 * @param url URL minted by the API, possibly on the emulator host alias
 * @param origin API origin reachable from this host
 * @returns the same path and token on the reachable origin
 */
export function rebaseOrigin(url: string, origin: string): string {
  const minted = new URL(url);
  const reachable = new URL(origin);

  return new URL(`${minted.pathname}${minted.search}`, reachable).toString();
}

/**
 * finds the newest code the development OTP driver issued since a moment
 * @param inbox JSON-lines inbox content
 * @param phoneNumber phone the code was issued to
 * @param since earliest issue time that qualifies
 * @returns the code, or null when none was issued yet
 */
export function latestDevelopmentOtp(
  inbox: string,
  phoneNumber: string,
  since: Date,
): string | null {
  const codes = inbox
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => otpEntrySchema.safeParse(JSON.parse(line)))
    .flatMap((entry) => (entry.success ? [entry.data] : []))
    .filter(
      (entry) =>
        entry.phoneNumber === phoneNumber &&
        Date.parse(entry.createdAt) >= since.getTime(),
    );

  return codes.at(-1)?.code ?? null;
}

/**
 * reuses a body's request key as the idempotency key, which some routes require to match
 * @param body JSON body of the request
 * @returns the body's request key, or a fresh key
 */
function requestKeyOf(body: unknown): string {
  const keyed = z.object({ requestKey: z.string() }).safeParse(body);

  return keyed.success ? keyed.data.requestKey : randomUUID();
}

/**
 * uploads one file through a signed single-part upload and completes it
 * @param transport JSON requests and minted-URL fetches of the session
 * @param transport.request JSON request as the demo owner
 * @param transport.fetchMinted fetch for URLs the API minted
 * @param input record, purpose, file name and bytes
 * @returns the new asset id
 */
async function uploadMedia(
  transport: Pick<DemoApi, 'request' | 'fetchMinted'>,
  input: DemoUpload,
): Promise<string> {
  const session = await transport.request(
    '/v1/media/uploads',
    uploadSessionSchema,
    {
      method: 'POST',
      body: {
        requestKey: randomUUID(),
        target: { kind: 'record', recordId: input.recordId },
        kind: input.purpose === 'voice_note' ? 'audio' : 'photo',
        purpose: input.purpose,
        componentIds: [],
        fileName: input.fileName,
        mimeType: input.purpose === 'voice_note' ? 'audio/mp4' : 'image/jpeg',
        byteLength: input.bytes.byteLength,
        sha256: createHash('sha256').update(input.bytes).digest('hex'),
      },
    },
  );
  if (session.mode !== 'single') {
    throw new Error(`Unexpected multipart upload for ${input.fileName}`);
  }
  const put = await transport.fetchMinted(session.putUrl, {
    method: 'PUT',
    headers: session.headers,
    body: new Uint8Array(input.bytes),
  });
  await readSuccess(put, `PUT ${input.fileName}`);
  await transport.request(
    `/v1/media/${session.assetId}/complete`,
    mediaCompletionSchema,
    { method: 'POST', body: { requestKey: randomUUID() } },
  );

  return session.assetId;
}

/**
 * polls the assets until the jobs drain has processed them
 * @param request JSON request as the demo owner
 * @param assetIds assets to wait for
 * @returns their ready media details
 */
async function waitForMedia(
  request: DemoRequest,
  assetIds: readonly string[],
): Promise<readonly MediaDetail[]> {
  const deadline = Date.now() + readyTimeoutMs;
  for (;;) {
    const details = await Promise.all(
      assetIds.map(async (id) => request(`/v1/media/${id}`, mediaDetailSchema)),
    );
    const failed = details.find((detail) => detail.asset.state === 'failed');
    if (failed) {
      throw new Error(`Media processing failed for ${failed.asset.id}`);
    }
    if (details.every((detail) => detail.asset.state === 'ready')) {
      return details;
    }
    if (Date.now() > deadline) {
      throw new Error(
        'Media is still processing; run `pnpm jobs:drain` against the same database until it is ready',
      );
    }
    await delay(readyPollIntervalMs);
  }
}

/**
 * requests a code, reads it from the inbox and verifies it
 * @param params API origin, owner phone and OTP inbox
 * @returns the session cookie header value
 */
async function signIn(params: DemoApiParams): Promise<string> {
  const requestedAt = new Date();
  await readSuccess(
    await fetch(`${params.origin}/api/auth/phone-number/send-otp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phoneNumber: params.phoneNumber }),
    }),
    'send OTP',
  );
  const code = await waitForOtp(params, requestedAt);
  const verified = await fetch(
    `${params.origin}/api/auth/phone-number/verify`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phoneNumber: params.phoneNumber, code }),
    },
  );
  await readSuccess(verified, 'verify OTP');
  const cookie = verified.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  if (!cookie) {
    throw new Error('OTP verification returned no session cookie');
  }

  return cookie;
}

/**
 * polls the inbox briefly for the code the send just issued
 * @param params owner phone and OTP inbox
 * @param since moment the code was requested
 * @returns the issued code
 */
async function waitForOtp(params: DemoApiParams, since: Date): Promise<string> {
  const deadline = Date.now() + otpWaitMs;
  for (;;) {
    const inbox = await readFile(params.inboxPath, 'utf8').catch(() => '');
    const code = latestDevelopmentOtp(inbox, params.phoneNumber, since);
    if (code) {
      return code;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `No OTP for ${params.phoneNumber} in ${params.inboxPath}; is the API running with that phone?`,
      );
    }
    await delay(otpPollIntervalMs);
  }
}

/**
 * reads a JSON body and fails with the API's error on a non-2xx status
 * @param response API response
 * @param label request description for the error
 * @returns parsed body, or null for an empty body
 */
async function readSuccess(
  response: Response,
  label: string,
): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} failed with ${response.status}: ${text}`);
  }

  return text ? JSON.parse(text) : null;
}
