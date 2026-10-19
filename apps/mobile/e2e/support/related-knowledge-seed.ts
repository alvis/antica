import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  knowledgeSearchPageSchema,
  recordDetailSchema,
  relatedKnowledgePageSchema,
} from '@antica/contracts';

import { latestOtp } from '../../../../tooling/run-maestro.ts';

const origin = process.env.ANTICA_E2E_API_URL ?? 'http://127.0.0.1:8080';
const phoneNumber = process.env.ANTICA_COLLECTOR_PHONE ?? '+15550100001';

/** Fails visibly if the fixture API rejects a request. */
async function json(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  if (!response.ok)
    throw new Error(`API ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

/** Uses the existing local OTP path without logging the synthetic login code. */
async function session(): Promise<string> {
  const source = process.env.ANTICA_DEV_OTP_INBOX;
  if (!source) throw new Error('ANTICA_DEV_OTP_INBOX is required');
  const since = new Date();
  await json(
    await fetch(`${origin}/api/auth/phone-number/send-otp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phoneNumber }),
    }),
  );
  const code = latestOtp(await readFile(source, 'utf8'), {
    phoneNumber,
    since,
    source,
  });
  const response = await fetch(`${origin}/api/auth/phone-number/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phoneNumber, code }),
  });
  await json(response);
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  if (!cookie) throw new Error('Verification returned no session cookie');
  return cookie;
}

/** Creates a disposable record and checks that the saved corpus actually matches it. */
async function main(): Promise<void> {
  const cookie = await session();
  const saved = knowledgeSearchPageSchema.parse(
    await json(
      await fetch(
        `${origin}/v1/knowledge/search?q=Doucai&view=saved&locale=en`,
        { headers: { cookie } },
      ),
    ),
  );
  const example = saved.hits.find(
    (hit) => hit.contentId === 'antica:entry:ceramics:aic-doucai-cups',
  );
  if (!example)
    throw new Error(
      'Run knowledge-seed.ts to save the Doucai corpus entry first',
    );
  const requestKey = randomUUID();
  const record = recordDetailSchema.parse(
    await json(
      await fetch(`${origin}/v1/records`, {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json',
          'Idempotency-Key': requestKey,
        },
        body: JSON.stringify({ unitKind: 'single', name: example.title }),
      }),
    ),
  );
  const page = relatedKnowledgePageSchema.parse(
    await json(
      await fetch(
        `${origin}/v1/records/${record.id}/related-knowledge?locale=en&limit=3&recordRevision=${record.recordRevision}`,
        { headers: { cookie } },
      ),
    ),
  );
  const card = page.cards.find((candidate) => candidate.excerpt);
  if (!card?.excerpt)
    throw new Error(
      'Save the Doucai corpus entry with knowledge-seed.ts first',
    );
  process.stdout.write(
    `${JSON.stringify({
      recordId: record.id,
      recordName: record.name,
      recordCode: record.code,
      entryId: card.entryId,
      revision: card.revision,
      claimKey: card.excerpt.claimKey,
      citationId: card.excerpt.citations[0].id,
    })}\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
