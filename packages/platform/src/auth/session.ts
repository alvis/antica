import { randomUUID } from 'node:crypto';
import { appendFile, chmod } from 'node:fs/promises';

import { expo } from '@better-auth/expo';

import { betterAuth } from 'better-auth';

import { z } from 'zod';

import { phoneNumber } from 'better-auth/plugins';

import { claimOtpSend } from '../database/otp-cooldown.js';

import { createSessionAdapter } from './session-adapter.js';

import type { Database } from '../database/connection.js';

const maximumAuthBodyBytes = 4096;
const sendAcknowledgement = {
  message: 'If the number is eligible, a code will be sent',
};

/** configures the one-collector Better Auth boundary */
export interface SessionConfig {
  readonly baseUrl: string;
  readonly secret: string;
  readonly collectorPhoneNumber: string;
  readonly otpDriver: 'development' | 'whatsapp';
  readonly developmentInboxPath?: string;
  readonly whatsappToken?: string;
  readonly whatsappPhoneNumberId?: string;
  readonly whatsappTemplateName?: string;
  readonly trustedOrigins: readonly string[];
}

/** collector authentication capabilities exposed to the API boundary */
export interface AuthSession {
  readonly handle: (request: Request) => Promise<Response>;
  readonly ownerId: (headers: Headers) => Promise<string | null>;
}

/**
 * binds the preseeded collector to a Better Auth phone session
 * @param db platform database containing the collector account and sessions
 * @param config phone, OTP driver, secret, and trusted-origin settings
 * @returns request handler and owner lookup bound to the collector session
 * @throws {Error} when the collector phone is not E.164, the development OTP driver runs in production, or the secret is shorter than 32 characters
 */
export function createAuthSession(
  db: Database,
  config: SessionConfig,
): AuthSession {
  if (!/^\+[1-9]\d{1,14}$/.test(config.collectorPhoneNumber)) {
    throw new Error('ANTICA_COLLECTOR_PHONE must be E.164');
  }
  if (
    process.env.NODE_ENV === 'production' &&
    config.otpDriver === 'development'
  ) {
    throw new Error('Development OTP inbox is forbidden in production');
  }
  if (config.secret.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must be at least 32 characters');
  }
  const auth = betterAuth({
    database: createSessionAdapter(db),
    secret: config.secret,
    baseURL: config.baseUrl,
    trustedOrigins: [...config.trustedOrigins],
    plugins: [
      expo(),
      phoneNumber({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 5,
        requireVerification: true,
        phoneNumberValidator: (phone) => phone === config.collectorPhoneNumber,
        sendOTP: async ({ phoneNumber: phone, code }) =>
          sendOtp(phone, code, config),
      }),
    ],
  });

  return {
    handle: async (request) => {
      const path = new URL(request.url).pathname;
      if (
        ![
          '/api/auth/phone-number/send-otp',
          '/api/auth/phone-number/verify',
          '/api/auth/get-session',
          '/api/auth/sign-out',
        ].includes(path)
      ) {
        return new Response(null, { status: 404 });
      }
      let forwarded = request;
      if (
        path === '/api/auth/phone-number/send-otp' ||
        path === '/api/auth/phone-number/verify'
      ) {
        let body: unknown;
        const bytes = await readBoundedBody(request, maximumAuthBodyBytes);
        if (bytes === null) {
          return authFailure(
            'VALIDATION_FAILED',
            'Authentication request is too large',
            false,
            413,
          );
        }
        const rawBody = new TextDecoder().decode(bytes);
        try {
          body = JSON.parse(rawBody);
        } catch {
          return authFailure(
            'VALIDATION_FAILED',
            'Invalid authentication request',
            false,
            422,
          );
        }
        forwarded = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: rawBody,
          signal: request.signal,
        });
        const input = z
          .object({ phoneNumber: z.string(), code: z.string().optional() })
          .safeParse(body);
        if (!input.success) {
          return authFailure(
            'VALIDATION_FAILED',
            'Invalid authentication request',
            false,
            422,
          );
        }
        if (input.data.phoneNumber !== config.collectorPhoneNumber) {
          if (path.endsWith('send-otp')) {
            return Response.json(sendAcknowledgement);
          }

          return authFailure(
            'OTP_INVALID',
            'Invalid verification code',
            false,
            401,
          );
        }
        if (path.endsWith('verify') && !/^\d{6}$/.test(input.data.code ?? '')) {
          return authFailure(
            'OTP_INVALID',
            'Invalid verification code',
            false,
            401,
          );
        }
        if (
          path.endsWith('send-otp') &&
          !(await claimOtpSend({ db, phoneNumber: input.data.phoneNumber }))
        ) {
          return Response.json(sendAcknowledgement);
        }
      }
      const response = await auth.handler(forwarded);
      if (path === '/api/auth/phone-number/send-otp') {
        return Response.json(sendAcknowledgement);
      }
      if (path === '/api/auth/phone-number/verify' && !response.ok) {
        let code: unknown;
        try {
          code = ((await response.clone().json()) as { code?: unknown }).code;
        } catch {
          /* keep the generic auth failure */
        }
        if (code === 'TOO_MANY_ATTEMPTS') {
          return authFailure(
            'RATE_LIMITED',
            'Too many verification attempts',
            true,
            429,
          );
        }
        if (code === 'OTP_EXPIRED' || code === 'EXPIRED_OTP') {
          return authFailure(
            'OTP_EXPIRED',
            'Verification code expired',
            false,
            410,
          );
        }

        return authFailure(
          'OTP_INVALID',
          'Invalid verification code',
          false,
          401,
        );
      }

      return response;
    },
    ownerId: async (headers) => {
      const session = await auth.api.getSession({ headers });

      return session?.user.phoneNumber === config.collectorPhoneNumber
        ? session.user.id
        : null;
    },
  };
}

/**
 * reads a request body without accepting more than the configured byte limit
 * @param request
 * @param limit
 */
async function readBoundedBody(
  request: Request,
  limit: number,
): Promise<Uint8Array | null> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > limit) {
    return null;
  }
  const stream = request.body as ReadableStream<Uint8Array> | null;
  if (stream === null) {
    return new Uint8Array();
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    let next = await reader.read();
    while (!next.done) {
      const value = next.value;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();

        return null;
      }
      chunks.push(value);
      next = await reader.read();
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

/**
 * creates the API error response for a local authentication failure
 * @param code
 * @param message
 * @param retryable
 * @param status
 */
function authFailure(
  code: 'VALIDATION_FAILED' | 'OTP_INVALID' | 'OTP_EXPIRED' | 'RATE_LIMITED',
  message: string,
  retryable: boolean,
  status: 401 | 410 | 413 | 422 | 429,
): Response {
  return Response.json(
    { code, message, retryable, requestId: randomUUID() },
    { status },
  );
}

/**
 * sends an OTP through the configured development or WhatsApp driver
 * @param phoneNumber
 * @param code
 * @param config
 */
async function sendOtp(
  phoneNumber: string,
  code: string,
  config: SessionConfig,
): Promise<void> {
  if (config.otpDriver === 'development') {
    if (!config.developmentInboxPath) {
      throw new Error('ANTICA_DEV_OTP_INBOX is required for development OTP');
    }
    await appendFile(
      config.developmentInboxPath,
      `${JSON.stringify({ phoneNumber, code, createdAt: new Date().toISOString() })}\n`,
      { mode: 0o600 },
    );
    await chmod(config.developmentInboxPath, 0o600);

    return;
  }
  if (
    !config.whatsappToken ||
    !config.whatsappPhoneNumberId ||
    !config.whatsappTemplateName
  ) {
    throw new Error('WhatsApp OTP configuration is incomplete');
  }
  const response = await fetch(
    `https://graph.facebook.com/v23.0/${encodeURIComponent(config.whatsappPhoneNumberId)}/messages`,
    {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${config.whatsappToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phoneNumber,
        type: 'template',
        template: {
          name: config.whatsappTemplateName,
          language: { code: 'zh_TW' },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: code }] },
          ],
        },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `WhatsApp OTP delivery failed with status ${response.status}`,
    );
  }
}
