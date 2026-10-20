import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  knowledgeEntryDetailV2Schema,
  knowledgeSearchPageSchema,
  knowledgeTopicTreeSchema,
  knowledgeUpdateV2Schema,
} from '@antica/contracts';

import type { KnowledgeSearchHit } from '@antica/contracts';

import { latestOtp } from '../../../../tooling/run-maestro.ts';

const apiOrigin = process.env.ANTICA_E2E_API_URL ?? 'http://127.0.0.1:8080';
const phoneNumber = process.env.ANTICA_COLLECTOR_PHONE ?? '+15550100001';
const inboxPath = process.env.ANTICA_DEV_OTP_INBOX;
const selectedContentIds = [
  'antica:entry:furniture:huanghuali-material',
  'antica:entry:ceramics:aic-doucai-cups',
  'antica:entry:jades:aic-dragon-pendant',
] as const;

/** Returns a parsed response and fails on any unexpected API status. */
async function readJson(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

/** Signs the synthetic collector into the development API without exposing the OTP. */
async function collectorCookie(path: string): Promise<string> {
  const requestedAt = new Date();
  await readJson(
    await fetch(`${apiOrigin}/api/auth/phone-number/send-otp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phoneNumber }),
    }),
  );
  const code = latestOtp(await readFile(path, 'utf8'), {
    phoneNumber,
    since: requestedAt,
    source: path,
  });
  const verified = await fetch(`${apiOrigin}/api/auth/phone-number/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phoneNumber, code }),
  });
  await readJson(verified);
  const cookie = verified.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  if (!cookie) {
    throw new Error('OTP verification returned no session cookie');
  }
  return cookie;
}

/** Reads all working hits so the selected corpus entries can be found by stable content ID. */
async function workingEntries(cookie: string) {
  const hits: KnowledgeSearchHit[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ view: 'working', limit: '50' });
    if (cursor) query.set('cursor', cursor);
    const response = await fetch(`${apiOrigin}/v1/knowledge/search?${query}`, {
      headers: { cookie },
    });
    const page = knowledgeSearchPageSchema.parse(await readJson(response));
    hits.push(...page.hits);
    cursor = page.nextCursor;
  } while (cursor);
  return hits;
}

/** Explicitly reviews and saves three installed drafts through the shipped API. */
async function main(): Promise<void> {
  if (!inboxPath) {
    throw new Error('ANTICA_DEV_OTP_INBOX is required');
  }
  const cookie = await collectorCookie(inboxPath);
  const hits = await workingEntries(cookie);
  const saved: string[] = [];
  for (const contentId of selectedContentIds) {
    const hit = hits.find((candidate) => candidate.contentId === contentId);
    if (!hit) throw new Error(`Installed corpus entry missing: ${contentId}`);
    if (hit.saved) {
      saved.push(contentId);
      continue;
    }
    const url = `${apiOrigin}/v1/knowledge/${hit.id}`;
    const detail = knowledgeEntryDetailV2Schema.parse(
      await readJson(
        await fetch(`${url}?view=working`, { headers: { cookie } }),
      ),
    );
    const content = detail.content;
    const input = knowledgeUpdateV2Schema.parse({
      requestKey: randomUUID(),
      expectedRevision: detail.revision,
      status: 'saved',
      content: {
        ...content,
        editorialReview: { state: content.editorialReview.state },
        claims: content.claims.map((claim) => ({
          ...claim,
          review: { state: claim.review.state },
          variants: claim.variants.map((variant) => ({
            ...variant,
            review: { state: variant.review.state },
          })),
        })),
      },
      reviewDecisions: content.claims
        .filter((claim) => claim.supportState === 'cited')
        .map((claim) => ({ claimKey: claim.claimKey, state: 'reviewed' })),
      translationDecisions: [],
    });
    const result = knowledgeEntryDetailV2Schema.parse(
      await readJson(
        await fetch(url, {
          method: 'PATCH',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify(input),
        }),
      ),
    );
    if (result.status !== 'saved') {
      throw new Error(`Review and save did not save ${contentId}`);
    }
    saved.push(contentId);
  }
  const example = hits.find(
    (candidate) => candidate.contentId === selectedContentIds[1],
  )!;
  const exampleDetail = knowledgeEntryDetailV2Schema.parse(
    await readJson(
      await fetch(`${apiOrigin}/v1/knowledge/${example.id}?view=saved`, {
        headers: { cookie },
      }),
    ),
  );
  const category = example.topics.find((topic) => topic.facet === 'category');
  const material = example.topics.find((topic) => topic.facet === 'material');
  if (!category) throw new Error('Example has no category topic');
  const tree = knowledgeTopicTreeSchema.parse(
    await readJson(
      await fetch(
        `${apiOrigin}/v1/knowledge/topics/${category.id}/tree?depth=1`,
        { headers: { cookie } },
      ),
    ),
  );
  const claim = exampleDetail.content.claims.find(
    (candidate) => candidate.citationIds.length > 0,
  );
  const image = exampleDetail.content.images[0];
  if (!claim || !image) {
    throw new Error(
      `Example support: children=${tree.descendants.length}, citedClaim=${Boolean(claim)}, images=${exampleDetail.content.images.length}`,
    );
  }
  for (const term of ['斗彩', 'Doucai']) {
    const query = new URLSearchParams({
      q: term,
      view: 'saved',
      topics: JSON.stringify({ category: [category.id] }),
    });
    const page = knowledgeSearchPageSchema.parse(
      await readJson(
        await fetch(`${apiOrigin}/v1/knowledge/search?${query}`, {
          headers: { cookie },
        }),
      ),
    );
    if (!page.hits.some((hit) => hit.id === example.id)) {
      throw new Error(`Example missing from saved search for ${term}`);
    }
  }
  process.stdout.write(
    `${JSON.stringify({
      saved,
      selectors: {
        categoryId: category.id,
        topicId: tree.descendants[0]?.id ?? tree.topic.id,
        materialId: material?.id ?? null,
        hasChildTopic: tree.descendants.length > 0,
        entryId: example.id,
        claimKey: claim.claimKey,
        citationId: claim.citationIds[0],
        imageId: image.id,
      },
    })}\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
