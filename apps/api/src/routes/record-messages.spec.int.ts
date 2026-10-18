import { randomUUID } from 'node:crypto';

import { describe, expect, inject } from 'vitest';

import { createRecordService } from '@antica/application/server';
import {
  editDraftResultSchema,
  observationSchema,
  recordDetailSchema,
  recordMessagePageSchema,
  recordMessagePostedSchema,
} from '@antica/contracts';

import { createHttpTest } from '../fixtures/http/test.js';
import { createLocalSettings } from '../fixtures/runtime.js';

import type { RecordEditingPort } from '@antica/application/ports';

import type { ApplicationSettings } from '../configuration.js';
import type { HttpFixture } from '../fixtures/http.js';

const FAIL = 'FAIL THE MODEL';
const reply = '開發示範：已依你提供的文字整理描述，請確認是否套用。';

/**
 * proposes a second field next to the development description change and fails on demand
 * @param inner development adapter whose description proposal is kept
 * @returns adapter that gives every draft two proposals
 */
function scripted(inner: RecordEditingPort): RecordEditingPort {
  return {
    draft: async (request, sourceText, context, selection) => {
      if (request.instructionZhHant === FAIL) {
        return {
          success: false,
          error: {
            code: 'MODEL_OUTPUT_INVALID',
            message: 'Scripted failure',
            retryable: false,
          },
          audit: { invocation: null, rawOutput: null },
        };
      }
      const drafted = await inner.draft(
        request,
        sourceText,
        context,
        selection,
      );
      if (!drafted.success) {
        return drafted;
      }
      const value = editDraftResultSchema.parse(drafted.data.value);

      return {
        success: true,
        data: {
          ...drafted.data,
          value: {
            ...value,
            proposedChanges: [
              ...value.proposedChanges,
              {
                id: randomUUID(),
                field: 'name',
                before: context.fields.name,
                proposed: 'Celadon vase',
                findingIds: [],
              },
            ],
          },
        },
      };
    },
  };
}

const base = createLocalSettings();
const settings: ApplicationSettings = {
  ...base,
  models: {
    ...base.models,
    models: {
      ...base.models.models,
      recordEditing: scripted(base.models.models.recordEditing),
    },
  },
};
const resources = inject('httpResources');
const it = createHttpTest(resources['routes/record-messages']!, settings);

async function createRecord(fixture: HttpFixture, name = 'Plain vase') {
  const created = await fixture.request(
    '/v1/records',
    'POST',
    { unitKind: 'single', name },
    randomUUID(),
  );

  return recordDetailSchema.parse(await created.json());
}

function post(body: string, extra: Record<string, unknown> = {}) {
  return {
    requestKey: randomUUID(),
    body,
    transcriptionIds: [],
    expectedRecordRevision: 1,
    ...extra,
  };
}

async function conversation(
  fixture: HttpFixture,
  recordId: string,
  query = '',
) {
  const response = await fixture.request(
    `/v1/records/${recordId}/messages${query}`,
  );
  expect(response.status).toBe(200);

  return recordMessagePageSchema.parse(await response.json());
}

describe('fn:createRecordMessageRoutes', () => {
  it('should answer a posted message once its job has run and show the draft as ready', async ({
    fixture,
  }) => {
    const record = await createRecord(fixture);
    const input = post('請把描述改成青瓷瓶');

    const posted = await fixture.request(
      `/v1/records/${record.id}/messages`,
      'POST',
      input,
    );

    expect(posted.status).toBe(202);
    const accepted = recordMessagePostedSchema.parse(await posted.json());
    expect(accepted).toMatchObject({
      editDraftId: input.requestKey,
      message: {
        recordId: record.id,
        author: 'collector',
        body: '請把描述改成青瓷瓶',
        editDraftId: input.requestKey,
      },
    });
    const waiting = await conversation(fixture, record.id);
    expect(waiting.items).toHaveLength(1);
    expect(waiting.items[0]).toMatchObject({
      author: 'collector',
      draft: { status: 'pending', proposedChanges: [] },
    });
    expect(await fixture.runtime.drain()).toMatchObject({
      settled: 1,
      failures: [],
    });

    const answered = await conversation(fixture, record.id);

    expect(answered.nextCursor).toBeNull();
    expect(answered.items.map((item) => item.author)).toEqual([
      'collector',
      'assistant',
    ]);
    expect(answered.items[1]).toMatchObject({
      recordId: record.id,
      body: reply,
      editDraftId: accepted.editDraftId,
    });
    for (const item of answered.items) {
      expect(item.draft).toMatchObject({
        status: 'ready',
        revision: 2,
        appliedProposalIds: [],
        proposedChanges: [
          { field: 'description', proposed: '請把描述改成青瓷瓶' },
          { field: 'name', proposed: 'Celadon vase' },
        ],
      });
    }
  });

  it('should write only the confirmed field through the existing apply route and report the draft as partially applied', async ({
    fixture,
  }) => {
    const record = await createRecord(fixture);
    await fixture.request(
      `/v1/records/${record.id}/messages`,
      'POST',
      post('整理描述'),
    );
    await fixture.runtime.drain();
    const [, ready] = (await conversation(fixture, record.id)).items;
    const [description, name] = ready!.draft.proposedChanges;

    const applied = await fixture.request(
      `/v1/edit-drafts/${ready!.editDraftId}/apply`,
      'POST',
      {
        requestKey: randomUUID(),
        expectedDraftRevision: ready!.draft.revision,
        expectedRecordRevision: 1,
        selectedProposalIds: [description!.id],
      },
    );

    expect(applied.status).toBe(200);
    expect(await applied.json()).toMatchObject({
      record: { description: '整理描述', name: 'Plain vase' },
    });
    const partial = await conversation(fixture, record.id);
    for (const item of partial.items) {
      expect(item.draft).toMatchObject({
        status: 'partially_applied',
        revision: 3,
        appliedProposalIds: [description!.id],
      });
    }
    const rest = await fixture.request(
      `/v1/edit-drafts/${ready!.editDraftId}/apply`,
      'POST',
      {
        requestKey: randomUUID(),
        expectedDraftRevision: 3,
        expectedRecordRevision: 2,
        selectedProposalIds: [name!.id],
      },
    );
    expect(rest.status).toBe(200);
    expect(
      (await conversation(fixture, record.id)).items.map(
        (item) => item.draft.status,
      ),
    ).toEqual(['applied', 'applied']);
  });

  it('should start nothing new when the same post is replayed by body or by header', async ({
    fixture,
  }) => {
    const record = await createRecord(fixture);
    const input = post('Replay me');
    const path = `/v1/records/${record.id}/messages`;
    const first = await fixture.request(path, 'POST', input);
    const { requestKey, ...withoutKey } = input;

    const byBody = await fixture.request(path, 'POST', input);
    const byHeader = await fixture.request(
      path,
      'POST',
      withoutKey,
      requestKey,
    );
    const matching = await fixture.request(path, 'POST', input, requestKey);

    for (const replay of [byBody, byHeader, matching]) {
      expect(replay.status).toBe(202);
      expect(await replay.json()).toEqual(await first.clone().json());
    }
    expect((await conversation(fixture, record.id)).items).toHaveLength(1);
    expect(await fixture.runtime.drain()).toMatchObject({ settled: 1 });
  });

  it('should refuse a replayed request key that carries a different body or record', async ({
    fixture,
  }) => {
    const record = await createRecord(fixture);
    const other = await createRecord(fixture, 'Other vase');
    const input = post('Original');
    await fixture.request(`/v1/records/${record.id}/messages`, 'POST', input);
    const conflicting = [
      [record.id, { ...input, body: 'Changed' }],
      [record.id, { ...input, expectedRecordRevision: 2 }],
      [other.id, input],
    ] as const;

    for (const [recordId, body] of conflicting) {
      const response = await fixture.request(
        `/v1/records/${recordId}/messages`,
        'POST',
        body,
      );

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
        message: 'Idempotency key was used for a different request',
      });
    }
    expect((await conversation(fixture, record.id)).items).toHaveLength(1);
    expect((await conversation(fixture, other.id)).items).toEqual([]);
    expect(await fixture.runtime.drain()).toMatchObject({ settled: 1 });
  });

  it('should refuse a request key already spent by POST /v1/edit-drafts and leave that draft alone', async ({
    fixture,
  }) => {
    const record = await createRecord(fixture);
    const observation = observationSchema.parse(
      await (
        await fixture.request(
          '/v1/observations',
          'POST',
          {
            recordId: record.id,
            componentIds: [],
            channel: 'typed',
            text: '手感粗糙',
            evidenceAnchorIds: [],
            checkIds: [],
            observedAt: new Date().toISOString(),
            voice: null,
            editDraftId: null,
            supersedesObservationId: null,
          },
          randomUUID(),
        )
      ).json(),
    );
    const requestKey = randomUUID();
    const draft = {
      requestKey,
      recordId: record.id,
      expectedRecordRevision: 2,
      transcriptionIds: [],
      observationIds: [observation.id],
      instructionZhHant: '整理描述',
    };
    const submitted = await fixture.request('/v1/edit-drafts', 'POST', draft);
    expect(submitted.status).toBe(202);

    const reused = await fixture.request(
      `/v1/records/${record.id}/messages`,
      'POST',
      post('整理描述', { requestKey, expectedRecordRevision: 2 }),
    );

    expect(reused.status).toBe(422);
    expect(await reused.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Idempotency key was used for a different request',
    });
    expect((await conversation(fixture, record.id)).items).toEqual([]);
    expect(await fixture.runtime.drain()).toMatchObject({
      settled: 1,
      failures: [],
    });
    expect((await conversation(fixture, record.id)).items).toEqual([]);
    const replayed = await fixture.request('/v1/edit-drafts', 'POST', draft);
    expect(replayed.status).toBe(202);
    expect(await replayed.json()).toEqual(await submitted.clone().json());
  });

  it('should answer racing posts with one stored message and a retryable 409 for the loser', async ({
    fixture,
  }) => {
    const record = await createRecord(fixture);
    const input = post('Race me');
    const path = `/v1/records/${record.id}/messages`;

    const responses = await Promise.all(
      Array.from({ length: 8 }, () => fixture.request(path, 'POST', input)),
    );

    const statuses = responses.map((response) => response.status);
    expect(statuses).toContain(202);
    for (const response of responses.filter(({ status }) => status !== 202)) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: 'REVISION_CONFLICT',
        retryable: true,
      });
    }
    const retried = await fixture.request(path, 'POST', input);
    expect(retried.status).toBe(202);
    const winner = responses.find(({ status }) => status === 202)!;
    expect(await retried.json()).toEqual(await winner.clone().json());
    expect((await conversation(fixture, record.id)).items).toHaveLength(1);
    expect(await fixture.runtime.drain()).toMatchObject({ settled: 1 });
  });

  it('should answer 404 for a record that belongs to another collector and write nothing', async ({
    fixture,
  }) => {
    const foreign = await createRecordService(
      fixture.runtime.transaction,
      fixture.runtime.clock,
      fixture.runtime.ids,
    ).create(randomUUID(), randomUUID(), {
      unitKind: 'single',
      name: 'Foreign vase',
    });
    if (!foreign.success) {
      throw new Error('Foreign record could not be created');
    }
    const path = `/v1/records/${foreign.data.id}/messages`;

    const posted = await fixture.request(path, 'POST', post('Hello'));
    const listed = await fixture.request(path);
    const missing = await fixture.request(
      `/v1/records/${randomUUID()}/messages`,
    );

    for (const response of [posted, listed, missing]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(await fixture.runtime.drain()).toMatchObject({ inspected: 0 });
  });

  it('should reject a post for a record that moved on without starting a draft', async ({
    fixture,
  }) => {
    const record = await createRecord(fixture);

    const response = await fixture.request(
      `/v1/records/${record.id}/messages`,
      'POST',
      post('Too late', { expectedRecordRevision: 5 }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'REVISION_CONFLICT' });
    expect((await conversation(fixture, record.id)).items).toEqual([]);
    expect(await fixture.runtime.drain()).toMatchObject({ inspected: 0 });
  });

  it.for([
    ['an empty body without transcriptions', post('')],
    ['a blank body without transcriptions', post('   ')],
    ['a missing request key', { ...post('x'), requestKey: undefined }],
    ['an unknown field', post('x', { extra: true })],
    ['a non-uuid transcription', post('x', { transcriptionIds: ['nope'] })],
  ] as const)('should answer 422 for %s', async ([, body], { fixture }) => {
    const record = await createRecord(fixture);

    const response = await fixture.request(
      `/v1/records/${record.id}/messages`,
      'POST',
      body,
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await conversation(fixture, record.id)).items).toEqual([]);
  });

  it('should answer 422 for a transcription that is not confirmed for the record', async ({
    fixture,
  }) => {
    const record = await createRecord(fixture);

    const response = await fixture.request(
      `/v1/records/${record.id}/messages`,
      'POST',
      post('', { transcriptionIds: [randomUUID()] }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'EVIDENCE_INVALID' });
    expect(await fixture.runtime.drain()).toMatchObject({ inspected: 0 });
  });

  it('should reject a header that disagrees with the body and bodies that are not objects', async ({
    fixture,
  }) => {
    const record = await createRecord(fixture);
    const path = `/v1/records/${record.id}/messages`;

    const mismatch = await fixture.request(
      path,
      'POST',
      post('x'),
      randomUUID(),
    );
    const nothing = await fixture.request(path, 'POST', null);
    const scalar = await fixture.request(path, 'POST', 5, randomUUID());
    const missingBody = await fixture.request(path, 'POST');

    expect(mismatch.status).toBe(422);
    expect(await mismatch.json()).toMatchObject({ field: 'Idempotency-Key' });
    for (const response of [nothing, scalar, missingBody]) {
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    }
    expect((await conversation(fixture, record.id)).items).toEqual([]);
  });

  it('should show a draft whose job failed as failed and give it no reply', async ({
    fixture,
  }) => {
    const record = await createRecord(fixture);
    await fixture.request(
      `/v1/records/${record.id}/messages`,
      'POST',
      post(FAIL),
    );

    await fixture.runtime.drain();
    const page = await conversation(fixture, record.id);

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      author: 'collector',
      body: FAIL,
      draft: { status: 'failed', proposedChanges: [], appliedProposalIds: [] },
    });
  });

  it('should page back from the newest messages with a cursor', async ({
    fixture,
  }) => {
    const record = await createRecord(fixture);
    const bodies = ['one', 'two', 'three'];
    for (const body of bodies) {
      await fixture.request(
        `/v1/records/${record.id}/messages`,
        'POST',
        post(body),
      );
    }
    await fixture.runtime.drain();

    const newest = await conversation(fixture, record.id, '?limit=2');
    const older = await conversation(
      fixture,
      record.id,
      `?limit=2&cursor=${encodeURIComponent(newest.nextCursor!)}`,
    );
    const oldest = await conversation(
      fixture,
      record.id,
      `?limit=2&cursor=${encodeURIComponent(older.nextCursor!)}`,
    );

    const chronological = [...oldest.items, ...older.items, ...newest.items];
    expect(newest.items.map((item) => item.author)).toEqual([
      'assistant',
      'assistant',
    ]);
    expect(chronological).toHaveLength(6);
    expect(new Set(chronological.map((item) => item.id)).size).toBe(6);
    expect(
      chronological
        .filter((item) => item.author === 'collector')
        .map((item) => item.body),
    ).toEqual(bodies);
    expect(oldest.nextCursor).toBeNull();
  });

  it.for([
    '?limit=0',
    '?limit=101',
    '?limit=1.5',
    '?limit=many',
    '?cursor=not-a-cursor',
  ])('should answer 422 for the query %s', async (query, { fixture }) => {
    const record = await createRecord(fixture);

    const response = await fixture.request(
      `/v1/records/${record.id}/messages${query}`,
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
