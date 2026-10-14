import { mkdtemp, readFile, rm } from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { collectorUserId, ensureCollectorUser } from '../database/collector.js';
import { otpSendCooldown, verification } from '../database/schema/auth.js';
import { createIsolatedDatabase } from '../database/spec/fixtures/isolated-database.js';

import { createAuthSession } from './session.js';

import type { SessionConfig } from './session.js';

const databaseUrl = process.env.ANTICA_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated migrated acceptance database',
  );
}
const baseUrl = 'http://localhost:8080';
const phoneNumber = '+447700900123';
const inboxEntrySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  phoneNumber: z.string(),
});

describe('fn:createAuthSession', () => {
  it('should preserve the private send acknowledgement when the development inbox is unconfigured', async () => {
    const database = await createIsolatedDatabase();
    try {
      const auth = createAuthSession(database.db, {
        baseUrl,
        secret: 'acceptance-secret-only-do-not-use-in-production',
        collectorPhoneNumber: phoneNumber,
        otpDriver: 'development',
        trustedOrigins: [baseUrl],
      });
      const response = await auth.handle(
        authRequest('phone-number/send-otp', { phoneNumber }),
      );
      expect({ status: response.status, body: await response.json() }).toEqual({
        status: 200,
        body: { message: 'If the number is eligible, a code will be sent' },
      });
    } finally {
      await database.close();
    }
  });
  it.each([
    {
      otpDriver: 'whatsapp',
      whatsappPhoneNumberId: 'synthetic-account',
      whatsappTemplateName: 'otp',
    },
    {
      otpDriver: 'whatsapp',
      whatsappToken: 'synthetic-token',
      whatsappTemplateName: 'otp',
    },
    {
      otpDriver: 'whatsapp',
      whatsappToken: 'synthetic-token',
      whatsappPhoneNumberId: 'synthetic-account',
    },
  ] satisfies Array<Partial<SessionConfig>>)(
    'should preserve private acknowledgement without sending when OTP delivery configuration is incomplete: %j',
    async (delivery) => {
      const send = vi.fn<typeof fetch>(async () => Response.json({}));
      vi.stubGlobal('fetch', send);
      const database = await createIsolatedDatabase();
      try {
        const auth = createAuthSession(database.db, {
          baseUrl,
          secret: 'acceptance-secret-only-do-not-use-in-production',
          collectorPhoneNumber: phoneNumber,
          trustedOrigins: [baseUrl],
          ...delivery,
        });
        const response = await auth.handle(
          authRequest('phone-number/send-otp', { phoneNumber }),
        );
        expect({
          status: response.status,
          body: await response.json(),
        }).toEqual({
          status: 200,
          body: { message: 'If the number is eligible, a code will be sent' },
        });
        expect(send).not.toHaveBeenCalled();
      } finally {
        await database.close();
      }
    },
  );
  it.each([200, 503])(
    'should submit a WhatsApp OTP template and preserve private acknowledgement for provider status %s',
    async (providerStatus) => {
      const requests: Request[] = [];
      vi.stubGlobal(
        'fetch',
        async (
          input: string | URL | Request,
          init?: RequestInit,
        ): Promise<Response> => {
          requests.push(new Request(input, init));

          return Response.json({}, { status: providerStatus });
        },
      );
      const database = await createIsolatedDatabase();
      try {
        const auth = createAuthSession(database.db, {
          baseUrl,
          secret: 'acceptance-secret-only-do-not-use-in-production',
          collectorPhoneNumber: phoneNumber,
          otpDriver: 'whatsapp',
          trustedOrigins: [baseUrl],
          whatsappToken: 'synthetic-token',
          whatsappPhoneNumberId: 'synthetic-account',
          whatsappTemplateName: 'collector_otp',
        });
        const response = await auth.handle(
          authRequest('phone-number/send-otp', { phoneNumber }),
        );
        expect({
          status: response.status,
          body: await response.json(),
        }).toEqual({
          status: 200,
          body: { message: 'If the number is eligible, a code will be sent' },
        });
        expect(requests).toHaveLength(1);
        expect({
          url: requests[0]!.url,
          method: requests[0]!.method,
          authorization: requests[0]!.headers.get('authorization'),
          body: await requests[0]!.json(),
        }).toEqual({
          url: 'https://graph.facebook.com/v23.0/synthetic-account/messages',
          method: 'POST',
          authorization: 'Bearer synthetic-token',
          body: {
            messaging_product: 'whatsapp',
            to: phoneNumber,
            type: 'template',
            template: {
              name: 'collector_otp',
              language: { code: 'zh_TW' },
              components: [
                {
                  type: 'body',
                  parameters: [
                    { type: 'text', text: expect.stringMatching(/^\d{6}$/) },
                  ],
                },
              ],
            },
          },
        });
      } finally {
        await database.close();
      }
    },
  );
  it.each([
    { body: '{', path: 'send-otp', status: 422, code: 'VALIDATION_FAILED' },
    { body: '{}', path: 'send-otp', status: 422, code: 'VALIDATION_FAILED' },
    {
      body: JSON.stringify({ phoneNumber }),
      path: 'verify',
      status: 401,
      code: 'OTP_INVALID',
    },
    {
      body: JSON.stringify({ phoneNumber, code: '12345' }),
      path: 'verify',
      status: 401,
      code: 'OTP_INVALID',
    },
    { body: null, path: 'send-otp', status: 422, code: 'VALIDATION_FAILED' },
  ])(
    'should reject malformed authentication input $body with $code',
    async ({ body, path, status, code }) => {
      const database = await createIsolatedDatabase();
      try {
        const auth = createAuthSession(database.db, {
          baseUrl,
          secret: 'acceptance-secret-only-do-not-use-in-production',
          collectorPhoneNumber: phoneNumber,
          otpDriver: 'development',
          trustedOrigins: [baseUrl],
        });
        const response = await auth.handle(
          new Request(`${baseUrl}/api/auth/phone-number/${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'origin': baseUrl },
            body,
          }),
        );
        expect({
          status: response.status,
          body: await response.json(),
        }).toMatchObject({ status, body: { code, retryable: false } });
        expect(await database.db.select().from(verification)).toEqual([]);
      } finally {
        await database.close();
      }
    },
  );

  it.each([
    {
      collectorPhoneNumber: '07700900123',
      secret: 'acceptance-secret-only-do-not-use-in-production',
      environment: 'test',
    },
    { collectorPhoneNumber: phoneNumber, secret: 'short', environment: 'test' },
    {
      collectorPhoneNumber: phoneNumber,
      secret: 'acceptance-secret-only-do-not-use-in-production',
      environment: 'production',
    },
  ])(
    'should reject unsafe authentication configuration $environment $collectorPhoneNumber $secret',
    async ({ collectorPhoneNumber, secret, environment }) => {
      vi.stubEnv('NODE_ENV', environment);
      const database = await createIsolatedDatabase();
      try {
        expect(() =>
          createAuthSession(database.db, {
            baseUrl,
            secret,
            collectorPhoneNumber,
            otpDriver: 'development',
            trustedOrigins: [baseUrl],
          }),
        ).toThrow();
      } finally {
        await database.close();
      }
    },
  );

  it('should reject an oversized declared body before creating a challenge', async () => {
    const database = await createIsolatedDatabase();
    try {
      const auth = createAuthSession(database.db, {
        baseUrl,
        secret: 'acceptance-secret-only-do-not-use-in-production',
        collectorPhoneNumber: phoneNumber,
        otpDriver: 'development',
        trustedOrigins: [baseUrl],
      });
      const response = await auth.handle(
        new Request(`${baseUrl}/api/auth/phone-number/send-otp`, {
          method: 'POST',
          headers: { 'content-length': '4097' },
          body: '{}',
        }),
      );
      expect(response.status).toBe(413);
      expect(await database.db.select().from(verification)).toEqual([]);
    } finally {
      await database.close();
    }
  });
  it.each(['expired', 'exhausted'] as const)(
    'should reject a correct code after its challenge is %s without creating a session',
    async (condition) => {
      const database = await createIsolatedDatabase();
      const directory = await mkdtemp(join(tmpdir(), 'antica-auth-rejection-'));
      const inboxPath = join(directory, 'otp.jsonl');
      try {
        await ensureCollectorUser({ db: database.db, phoneNumber });
        await database.db
          .delete(verification)
          .where(eq(verification.identifier, phoneNumber));
        await database.db
          .delete(otpSendCooldown)
          .where(eq(otpSendCooldown.phoneNumber, phoneNumber));
        const auth = createAuthSession(database.db, {
          baseUrl,
          secret: 'acceptance-secret-only-do-not-use-in-production',
          collectorPhoneNumber: phoneNumber,
          otpDriver: 'development',
          developmentInboxPath: inboxPath,
          trustedOrigins: [baseUrl],
        });
        expect(
          (
            await auth.handle(
              authRequest('phone-number/send-otp', { phoneNumber }),
            )
          ).status,
        ).toBe(200);
        const challenge = inboxEntrySchema.parse(
          JSON.parse((await readFile(inboxPath, 'utf8')).trim()),
        );
        if (condition === 'expired') {
          await database.db
            .update(verification)
            .set({ expiresAt: new Date(Date.now() - 1_000) })
            .where(eq(verification.identifier, phoneNumber));
        } else {
          const wrongCode = challenge.code === '000000' ? '999999' : '000000';
          for (let attempt = 0; attempt < 5; attempt += 1) {
            expect(
              (
                await auth.handle(
                  authRequest('phone-number/verify', {
                    phoneNumber,
                    code: wrongCode,
                  }),
                )
              ).status,
            ).toBe(401);
          }
        }
        const rejected = await auth.handle(
          authRequest('phone-number/verify', {
            phoneNumber,
            code: challenge.code,
          }),
        );
        expect(rejected.status).toBeGreaterThanOrEqual(400);
        expect(await rejected.json()).toMatchObject({
          code: condition === 'expired' ? 'OTP_EXPIRED' : 'RATE_LIMITED',
        });
        expect(rejected.headers.getSetCookie()).toEqual([]);
        expect(await auth.ownerId(new Headers())).toBeNull();
      } finally {
        await database.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it('should enforce the allowlist and resend cooldown then reopen and revoke the same collector session', async () => {
    const database = await createIsolatedDatabase();
    const directory = await mkdtemp(join(tmpdir(), 'antica-auth-'));
    const inboxPath = join(directory, 'otp.jsonl');
    const config = {
      baseUrl,
      secret: 'acceptance-secret-only-do-not-use-in-production',
      collectorPhoneNumber: phoneNumber,
      otpDriver: 'development' as const,
      developmentInboxPath: inboxPath,
      trustedOrigins: [baseUrl],
    };
    try {
      await ensureCollectorUser({ db: database.db, phoneNumber });
      await database.db
        .delete(otpSendCooldown)
        .where(eq(otpSendCooldown.phoneNumber, phoneNumber));
      const auth = createAuthSession(database.db, config);

      const unknown = await auth.handle(
        authRequest('phone-number/send-otp', { phoneNumber: '+447700900999' }),
      );
      const forbidden = await auth.handle(
        authRequest('phone-number/verify', {
          phoneNumber: '+447700900999',
          code: '123456',
        }),
      );
      const signup = await auth.handle(
        authRequest('sign-up/email', {
          email: 'attacker@example.org',
          password: 'not-a-real-password',
        }),
      );
      expect([unknown.status, forbidden.status, signup.status]).toEqual([
        200, 401, 404,
      ]);
      await expect(readFile(inboxPath, 'utf8')).rejects.toThrow();

      const sent = await auth.handle(
        authRequest('phone-number/send-otp', { phoneNumber }),
      );
      const savedChallenge = await database.db
        .select()
        .from(verification)
        .where(eq(verification.identifier, phoneNumber));
      const initialCooldown = await database.db
        .select()
        .from(otpSendCooldown)
        .where(eq(otpSendCooldown.phoneNumber, phoneNumber));
      expect(initialCooldown).toHaveLength(1);
      const resent = await auth.handle(
        authRequest('phone-number/send-otp', { phoneNumber }),
      );
      const unknownAgain = await auth.handle(
        authRequest('phone-number/send-otp', { phoneNumber: '+447700900999' }),
      );
      expect([
        sent.status,
        resent.status,
        unknown.status,
        unknownAgain.status,
      ]).toEqual([200, 200, 200, 200]);
      const acknowledgement = await sent.json();
      expect(acknowledgement).toEqual({
        message: 'If the number is eligible, a code will be sent',
      });
      expect(await resent.json()).toEqual(acknowledgement);
      expect(await unknown.json()).toEqual(acknowledgement);
      expect(await unknownAgain.json()).toEqual(acknowledgement);
      expect(
        await database.db
          .select()
          .from(verification)
          .where(eq(verification.identifier, phoneNumber)),
      ).toEqual(savedChallenge);
      expect(
        await database.db
          .select()
          .from(otpSendCooldown)
          .where(eq(otpSendCooldown.phoneNumber, phoneNumber)),
      ).toEqual(initialCooldown);
      expect(
        await database.db
          .select()
          .from(verification)
          .where(eq(verification.identifier, '+447700900999')),
      ).toEqual([]);
      expect(
        await database.db
          .select()
          .from(otpSendCooldown)
          .where(eq(otpSendCooldown.phoneNumber, '+447700900999')),
      ).toEqual([]);
      const entries = (await readFile(inboxPath, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => inboxEntrySchema.parse(JSON.parse(line)));
      expect(entries).toHaveLength(1);
      const challenge = entries[0]!;
      expect(challenge.phoneNumber).toBe(phoneNumber);
      const wrongCode = challenge.code === '000000' ? '999999' : '000000';
      const wrong = await auth.handle(
        authRequest('phone-number/verify', { phoneNumber, code: wrongCode }),
      );
      expect(wrong.status).toBeGreaterThanOrEqual(400);
      expect(await wrong.json()).toMatchObject({ code: 'OTP_INVALID' });

      const verified = await auth.handle(
        authRequest('phone-number/verify', {
          phoneNumber,
          code: challenge.code,
        }),
      );
      expect(verified.status).toBe(200);
      const cookie = verified.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ');
      expect(cookie.length).toBeGreaterThan(0);
      const reopened = createAuthSession(database.db, config);
      expect(await reopened.ownerId(new Headers({ cookie }))).toBe(
        collectorUserId,
      );
      const replayed = await auth.handle(
        authRequest('phone-number/verify', {
          phoneNumber,
          code: challenge.code,
        }),
      );
      expect(replayed.status).toBeGreaterThanOrEqual(400);

      const signedOut = await reopened.handle(
        new Request(`${baseUrl}/api/auth/sign-out`, {
          method: 'POST',
          headers: {
            cookie,
            'origin': baseUrl,
            'content-type': 'application/json',
          },
          body: '{}',
        }),
      );
      expect(signedOut.status).toBe(200);
      expect(await reopened.ownerId(new Headers({ cookie }))).toBeNull();
    } finally {
      await database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it.each([undefined, '1'])(
    'should cancel oversized chunked authentication bodies with Content-Length %s before invoking the sender',
    async (contentLength) => {
      const database = await createIsolatedDatabase();
      const directory = await mkdtemp(join(tmpdir(), 'antica-auth-body-'));
      const inboxPath = join(directory, 'otp.jsonl');
      try {
        await ensureCollectorUser({ db: database.db, phoneNumber });
        await database.db
          .delete(verification)
          .where(eq(verification.identifier, phoneNumber));
        await database.db
          .delete(otpSendCooldown)
          .where(eq(otpSendCooldown.phoneNumber, phoneNumber));
        const auth = createAuthSession(database.db, {
          baseUrl,
          secret: 'acceptance-secret-only-do-not-use-in-production',
          collectorPhoneNumber: phoneNumber,
          otpDriver: 'development',
          developmentInboxPath: inboxPath,
          trustedOrigins: [baseUrl],
        });
        const cancel = vi.fn();
        const pull = vi.fn(
          (controller: ReadableStreamDefaultController<Uint8Array>) =>
            controller.enqueue(new Uint8Array(2048)),
        );
        const body = new ReadableStream<Uint8Array>(
          { pull, cancel },
          { highWaterMark: 0 },
        );
        const headers = new Headers({
          'content-type': 'application/json',
          'origin': baseUrl,
        });
        if (contentLength !== undefined) {
          headers.set('content-length', contentLength);
        }
        const requestInit = {
          method: 'POST',
          headers,
          body,
          duplex: 'half',
        } satisfies RequestInit & { duplex: 'half' };
        const response = await auth.handle(
          new Request(`${baseUrl}/api/auth/phone-number/send-otp`, requestInit),
        );
        expect(response.status).toBe(413);
        expect(await response.json()).toMatchObject({
          code: 'VALIDATION_FAILED',
        });
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(pull).toHaveBeenCalledTimes(3);
        await expect(readFile(inboxPath, 'utf8')).rejects.toThrow();
        expect(
          await database.db
            .select()
            .from(verification)
            .where(eq(verification.identifier, phoneNumber)),
        ).toEqual([]);
        expect(
          await database.db
            .select()
            .from(otpSendCooldown)
            .where(eq(otpSendCooldown.phoneNumber, phoneNumber)),
        ).toEqual([]);
      } finally {
        await database.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});

function authRequest(path: string, body: unknown): Request {
  return new Request(`${baseUrl}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'origin': baseUrl },
    body: JSON.stringify(body),
  });
}
