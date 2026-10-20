import { createHash, randomUUID } from 'node:crypto';

import { describe, expect, inject } from 'vitest';

import {
  createRecordService,
  createKnowledgeService,
  validateKnowledgeAnswerSegments,
} from '@antica/application/server';
import {
  editDraftResultSchema,
  knowledgeNoSupportedAnswer,
  knowledgeEvidenceSnapshotV1Schema,
  observationSchema,
  recordDetailSchema,
  recordHistoryPageSchema,
  recordMessagePageSchema,
  recordMessagePostedSchema,
  transcriptionAcceptedSchema,
  transcriptionDetailSchema,
  uploadSessionSchema,
} from '@antica/contracts';
import { createAiSdkModels } from '@antica/platform/ai';

import { createHttpTest } from '../fixtures/http/test.js';
import { createLocalSettings } from '../fixtures/runtime.js';

import type {
  RecordEditingPort,
  TranscriptionPort,
} from '@antica/application/ports';
import type { ModelInvocation, KnowledgeWriteV2 } from '@antica/contracts';

import type { ApplicationSettings } from '../configuration.js';
import type { HttpFixture } from '../fixtures/http.js';

const FAIL = 'FAIL THE MODEL';
const GROUNDED = 'Explain the saved museum claim';
const PLAIN_QUESTION = '這是甚麼器物？';
const PLAIN_EDIT = '請把描述改為青瓷瓶';
const DEVELOPMENT_QUESTION = 'What do the saved sources say?';
const NO_OUTPUT = 'Provider gives no structured response';
const noOutputCalls = { count: 0 };
const noOutputModel = {
  specificationVersion: 'v4',
  provider: 'test',
  modelId: 'empty-provider',
  supportedUrls: {},
  doGenerate: async () => {
    noOutputCalls.count += 1;

    return {
      content: [],
      finishReason: { unified: 'content-filter', raw: 'content-filter' },
      usage: {
        inputTokens: {
          total: undefined,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: undefined,
          text: undefined,
          reasoning: undefined,
        },
      },
      warnings: [],
    };
  },
  doStream: async () => {
    throw new Error('Streaming is not used by this fixture');
  },
} satisfies NonNullable<
  Parameters<typeof createAiSdkModels>[0]['languageModels']
>[string];
const reply = '開發示範：已依你提供的文字整理描述，請確認是否套用。';

/**
 * proposes a second field next to the development description change and fails on demand
 * @param inner development adapter whose description proposal is kept
 * @returns adapter that gives every draft two proposals
 */
function scripted(inner: RecordEditingPort): RecordEditingPort {
  return {
    draft: async (request, sourceText, context, selection) => {
      if (request.instructionZhHant === NO_OUTPUT) {
        return createAiSdkModels({
          profiles: [
            {
              modelId: selection.modelId,
              provider: 'gateway',
              providerModelVersion: null,
              adapterKind: 'live',
              roles: ['recordEditing'],
              capabilities: {
                textInput: true,
                imageInput: false,
                audioInput: false,
                structuredOutput: true,
                toolCalling: false,
              },
            },
          ],
          languageModels: { [selection.modelId]: noOutputModel },
        }).recordEditing.draft(request, sourceText, context, selection);
      }
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
      // This scenario exercises the actual development output through the real worker validator.
      if (
        [DEVELOPMENT_QUESTION, PLAIN_QUESTION, PLAIN_EDIT].includes(
          request.instructionZhHant,
        )
      ) {
        return drafted;
      }
      const value = editDraftResultSchema.parse(drafted.data.value);
      if (request.instructionZhHant === GROUNDED) {
        const entry = context.knowledgeContext?.entries[0];
        const claim = entry?.claims[0];
        if (!entry || !claim) {
          throw new Error('Expected frozen museum evidence');
        }
        const text = `${claim.statement} ${claim.uncertainty ?? ''}`.trim();

        return {
          success: true,
          data: {
            ...drafted.data,
            value: {
              ...value,
              replyZhHant: text,
              proposedChanges: [],
              answerSegments: [
                {
                  text,
                  evidenceRefs: [
                    {
                      entryId: entry.entryId,
                      revision: entry.revision,
                      claimKey: claim.claimKey,
                      citationIds: claim.citations.map(
                        (citation) => citation.citationId,
                      ),
                    },
                  ],
                },
              ],
            },
          },
        };
      }

      return {
        success: true,
        data: {
          ...drafted.data,
          value: {
            ...value,
            answerSegments: [{ text: value.replyZhHant, evidenceRefs: [] }],
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

const SPOKEN_ORIGINAL = '呢個瓶有啲鞋';
const SPOKEN_READING = '這個瓶子有點粗糙';

const scriptedInvocation: ModelInvocation = {
  requestedModelId: 'development:transcription',
  effectiveModelId: 'development:transcription',
  provider: 'development',
  providerModelVersion: null,
  adapterKind: 'development',
  capabilities: {
    textInput: false,
    imageInput: false,
    audioInput: true,
    structuredOutput: true,
    toolCalling: false,
  },
  role: 'transcription',
  profileVersion: '1',
  promptVersion: '1',
  schemaVersion: '1',
  effectiveOptions: {},
  latencyMs: 0,
  usage: { inputTokens: null, outputTokens: null },
  finishReason: 'stop',
  citationCheck: { valid: true, rejectedReferenceIds: [] },
};

/** gives every audio note a fixed transcript, which the development adapter refuses to do */
const transcribing: TranscriptionPort = {
  transcribe: async (request) => ({
    success: true,
    data: {
      value: {
        transcriptionId: request.requestKey,
        recordId: request.recordId,
        audioAssetId: request.audioAssetId,
        originalText: SPOKEN_ORIGINAL,
        readingTextZhHant: SPOKEN_READING,
        detectedLanguages: ['yue'],
        uncertainTerms: [],
        segments: [],
      },
      invocation: scriptedInvocation,
    },
  }),
};

const base = createLocalSettings();
const settings: ApplicationSettings = {
  ...base,
  models: {
    ...base.models,
    models: {
      ...base.models.models,
      recordEditing: scripted(base.models.models.recordEditing),
      transcription: transcribing,
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

  expect(created.status, await created.clone().text()).toBe(201);

  return recordDetailSchema.parse(await created.json());
}

/**
 * records a short voice note on a record and runs its transcription job
 * @param fixture authenticated API under test
 * @param recordId record the note belongs to
 * @param drain whether the transcription job runs, which makes the transcription ready
 * @returns the transcription ID and its state
 */
async function transcribe(
  fixture: HttpFixture,
  recordId: string,
  drain = true,
) {
  const bytes = Buffer.alloc(46);
  bytes.write('RIFF');
  bytes.writeUInt32LE(38, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(2, 40);
  const started = await fixture.request('/v1/media/uploads', 'POST', {
    requestKey: randomUUID(),
    target: { kind: 'record', recordId },
    kind: 'audio',
    purpose: 'voice_note',
    componentIds: [],
    fileName: 'voice.wav',
    mimeType: 'audio/wav',
    byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  const upload = uploadSessionSchema.parse(await started.json());
  if (upload.mode !== 'single') {
    throw new Error('Expected local single upload');
  }
  await fixture.runtime.app.request(upload.putUrl, {
    method: 'PUT',
    headers: upload.headers,
    body: bytes,
  });
  await fixture.request(`/v1/media/${upload.assetId}/complete`, 'POST', {
    requestKey: randomUUID(),
  });
  await fixture.runtime.drain();
  const record = recordDetailSchema.parse(
    await (await fixture.request(`/v1/records/${recordId}`)).json(),
  );
  const submitted = await fixture.request('/v1/transcriptions', 'POST', {
    requestKey: randomUUID(),
    recordId,
    audioAssetId: upload.assetId,
    expectedRecordRevision: record.recordRevision,
    vocabularyHints: [],
  });
  const accepted = transcriptionAcceptedSchema.parse(await submitted.json());
  if (drain) {
    await fixture.runtime.drain();
  }
  const detail = transcriptionDetailSchema.parse(
    await (
      await fixture.request(`/v1/transcriptions/${accepted.transcriptionId}`)
    ).json(),
  );

  return { id: accepted.transcriptionId, detail };
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

/**
 * posts a message and runs its job so the conversation shows a ready edit card with two proposals
 * @param fixture authenticated HTTP fixture
 * @returns the record, collector message, ready entry, its name proposal, and an apply call against the card
 */
async function readyCard(fixture: HttpFixture) {
  const record = await createRecord(fixture);
  await fixture.request(
    `/v1/records/${record.id}/messages`,
    'POST',
    post('整理描述'),
  );
  await fixture.runtime.drain();
  const [collector, ready] = (await conversation(fixture, record.id)).items;
  const name = ready!.draft.proposedChanges.find(
    (change) => change.field === 'name',
  )!;
  const apply = async (
    decision: Record<string, unknown>,
    expectedDraftRevision = ready!.draft.revision,
  ): Promise<Response> =>
    fixture.request(`/v1/edit-drafts/${ready!.editDraftId}/apply`, 'POST', {
      requestKey: randomUUID(),
      expectedDraftRevision,
      expectedRecordRevision: 1,
      ...decision,
    });

  return { record, collector: collector!, ready: ready!, name, apply };
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
        skippedProposalIds: [],
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

  it('should answer a decision that overlaps, repeats, or decides nothing with 422', async ({
    fixture,
  }) => {
    const { name, apply } = await readyCard(fixture);

    for (const invalid of [
      { selectedProposalIds: [name.id], skippedProposalIds: [name.id] },
      { selectedProposalIds: [], skippedProposalIds: [name.id, name.id] },
      { selectedProposalIds: [], skippedProposalIds: [] },
    ]) {
      const response = await apply(invalid);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    }
  });

  it('should record a reject-only apply as skipped without writing the record', async ({
    fixture,
  }) => {
    const { record, ready, name, apply } = await readyCard(fixture);

    const rejected = await apply({
      selectedProposalIds: [],
      skippedProposalIds: [name.id],
    });

    expect(rejected.status).toBe(200);
    expect(await rejected.json()).toMatchObject({
      draft: {
        status: 'partially_applied',
        revision: 3,
        appliedProposalIds: [],
        skippedProposalIds: [name.id],
      },
      record: { recordRevision: 1, name: 'Plain vase' },
    });
    expect(
      recordDetailSchema.parse(
        await (await fixture.request(`/v1/records/${record.id}`)).json(),
      ),
    ).toMatchObject({ recordRevision: 1, name: 'Plain vase' });
    expect(
      await (
        await fixture.request(`/v1/edit-drafts/${ready.editDraftId}`)
      ).json(),
    ).toMatchObject({
      status: 'partially_applied',
      skippedProposalIds: [name.id],
    });
    for (const item of (await conversation(fixture, record.id)).items) {
      expect(item.draft).toMatchObject({
        status: 'partially_applied',
        revision: 3,
        appliedProposalIds: [],
        skippedProposalIds: [name.id],
      });
    }
  });

  it('should refuse to apply or skip a rejected proposal again', async ({
    fixture,
  }) => {
    const { name, apply } = await readyCard(fixture);
    await apply({ selectedProposalIds: [], skippedProposalIds: [name.id] });

    for (const again of [
      { selectedProposalIds: [name.id] },
      { selectedProposalIds: [], skippedProposalIds: [name.id] },
    ]) {
      const response = await apply(again, 3);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
        message: 'Selected proposal is unavailable',
      });
    }
  });

  it('should list a rejected proposal in history as skipped and linked to its message', async ({
    fixture,
  }) => {
    const { record, collector, name, apply } = await readyCard(fixture);
    await apply({ selectedProposalIds: [], skippedProposalIds: [name.id] });

    const history = recordHistoryPageSchema.parse(
      await (await fixture.request(`/v1/records/${record.id}/history`)).json(),
    );

    expect(history.items).toEqual([
      expect.objectContaining({
        field: 'name',
        before: name.before,
        after: name.proposed,
        status: 'skipped',
        source: {
          kind: 'editDraft',
          editDraftId: collector.editDraftId,
          proposalId: name.id,
          recordMessageId: collector.id,
        },
      }),
    ]);
  });

  it('should adopt a confirmed proposal and skip a rejected one in one apply', async ({
    fixture,
  }) => {
    const record = await createRecord(fixture);
    await fixture.request(
      `/v1/records/${record.id}/messages`,
      'POST',
      post('整理描述'),
    );
    await fixture.runtime.drain();
    const [collector, ready] = (await conversation(fixture, record.id)).items;
    const [description, name] = ready!.draft.proposedChanges;

    const applied = await fixture.request(
      `/v1/edit-drafts/${ready!.editDraftId}/apply`,
      'POST',
      {
        requestKey: randomUUID(),
        expectedDraftRevision: ready!.draft.revision,
        expectedRecordRevision: 1,
        selectedProposalIds: [description!.id],
        skippedProposalIds: [name!.id],
      },
    );

    expect(applied.status).toBe(200);
    expect(await applied.json()).toMatchObject({
      draft: {
        status: 'applied',
        appliedProposalIds: [description!.id],
        skippedProposalIds: [name!.id],
      },
      record: {
        recordRevision: 2,
        description: '整理描述',
        name: 'Plain vase',
      },
    });
    const history = recordHistoryPageSchema.parse(
      await (await fixture.request(`/v1/records/${record.id}/history`)).json(),
    );
    expect(
      history.items.map(({ field, status, source }) => ({
        field,
        status,
        source,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          field: 'description',
          status: 'accepted',
          source: {
            kind: 'editDraft',
            editDraftId: collector!.editDraftId,
            proposalId: description!.id,
            recordMessageId: collector!.id,
          },
        },
        {
          field: 'name',
          status: 'skipped',
          source: {
            kind: 'editDraft',
            editDraftId: collector!.editDraftId,
            proposalId: name!.id,
            recordMessageId: collector!.id,
          },
        },
      ]),
    );
    expect(history.items).toHaveLength(2);
  });

  it('should link the history of an adopted proposal to the collector message once', async ({
    fixture,
  }) => {
    const record = await createRecord(fixture);
    await fixture.request(
      `/v1/records/${record.id}/messages`,
      'POST',
      post('整理描述'),
    );
    await fixture.runtime.drain();
    const [collector, assistant] = (await conversation(fixture, record.id))
      .items;
    expect(assistant!.editDraftId).toBe(collector!.editDraftId);
    const [description] = assistant!.draft.proposedChanges;
    const applied = await fixture.request(
      `/v1/edit-drafts/${collector!.editDraftId}/apply`,
      'POST',
      {
        requestKey: randomUUID(),
        expectedDraftRevision: assistant!.draft.revision,
        expectedRecordRevision: 1,
        selectedProposalIds: [description!.id],
      },
    );
    expect(applied.status).toBe(200);

    const history = recordHistoryPageSchema.parse(
      await (await fixture.request(`/v1/records/${record.id}/history`)).json(),
    );

    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({
      field: 'description',
      status: 'accepted',
      source: {
        kind: 'editDraft',
        editDraftId: collector!.editDraftId,
        proposalId: description!.id,
        recordMessageId: collector!.id,
      },
    });
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
      Array.from({ length: 8 }, async () =>
        fixture.request(path, 'POST', input),
      ),
    );

    const statuses = responses.map((response) => response.status);
    expect(statuses).toContain(202);
    for (const response of responses.filter(({ status }) => status !== 202)) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: 'REQUEST_IN_PROGRESS',
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

  describe('with ready transcriptions', () => {
    it('should accept a ready transcription that was never confirmed, create no observation, and leave the record revision alone', async ({
      fixture,
    }) => {
      const record = await createRecord(fixture);
      const voice = await transcribe(fixture, record.id);
      expect(voice.detail).toMatchObject({
        status: 'ready',
        confirmedObservationId: null,
      });
      const before = recordDetailSchema.parse(
        await (await fixture.request(`/v1/records/${record.id}`)).json(),
      );
      const edited = '請把描述改成：青瓷瓶，表面粗糙';

      const posted = await fixture.request(
        `/v1/records/${record.id}/messages`,
        'POST',
        post(edited, {
          transcriptionIds: [voice.id],
          expectedRecordRevision: before.recordRevision,
        }),
      );

      expect(posted.status).toBe(202);
      const accepted = recordMessagePostedSchema.parse(await posted.json());
      expect(accepted.message.body).toBe(edited);
      const after = recordDetailSchema.parse(
        await (await fixture.request(`/v1/records/${record.id}`)).json(),
      );
      expect(after.recordRevision).toBe(before.recordRevision);
      const observations = await fixture.request(
        `/v1/records/${record.id}/observations`,
      );
      expect(await observations.json()).toMatchObject({ items: [] });
      expect(
        transcriptionDetailSchema.parse(
          await (
            await fixture.request(`/v1/transcriptions/${voice.id}`)
          ).json(),
        ),
      ).toMatchObject({ status: 'ready', confirmedObservationId: null });
      expect(await fixture.runtime.drain()).toMatchObject({
        settled: 1,
        failures: [],
      });
      const draft = await (
        await fixture.request(`/v1/edit-drafts/${accepted.editDraftId}`)
      ).json();
      expect(draft).toMatchObject({
        status: 'ready',
        snapshot: {
          observationIds: [],
          transcriptionVersions: [{ id: voice.id, revision: 2 }],
          sourceText: [
            { kind: 'transcription', id: voice.id, text: SPOKEN_READING },
          ],
        },
      });
      const page = await conversation(fixture, record.id);
      expect(page.items.map((item) => item.author)).toEqual([
        'collector',
        'assistant',
      ]);
    });

    it('should store the spoken reading text when the body is empty', async ({
      fixture,
    }) => {
      const record = await createRecord(fixture);
      const voice = await transcribe(fixture, record.id);
      const current = recordDetailSchema.parse(
        await (await fixture.request(`/v1/records/${record.id}`)).json(),
      );

      const posted = await fixture.request(
        `/v1/records/${record.id}/messages`,
        'POST',
        post('', {
          transcriptionIds: [voice.id],
          expectedRecordRevision: current.recordRevision,
        }),
      );

      expect(posted.status).toBe(202);
      expect(
        recordMessagePostedSchema.parse(await posted.json()),
      ).toMatchObject({ message: { body: SPOKEN_READING } });
    });

    it('should reject a transcription whose job has not run and start nothing', async ({
      fixture,
    }) => {
      const record = await createRecord(fixture);
      const voice = await transcribe(fixture, record.id, false);
      expect(voice.detail.status).toBe('pending');
      const current = recordDetailSchema.parse(
        await (await fixture.request(`/v1/records/${record.id}`)).json(),
      );

      const posted = await fixture.request(
        `/v1/records/${record.id}/messages`,
        'POST',
        post('Pending', {
          transcriptionIds: [voice.id],
          expectedRecordRevision: current.recordRevision,
        }),
      );

      expect(posted.status).toBe(422);
      expect(await posted.json()).toMatchObject({ code: 'EVIDENCE_INVALID' });
      expect((await conversation(fixture, record.id)).items).toEqual([]);
    });

    it('should reject a ready transcription that belongs to another record', async ({
      fixture,
    }) => {
      const record = await createRecord(fixture);
      const other = await createRecord(fixture, 'Other vase');
      const voice = await transcribe(fixture, other.id);
      const current = recordDetailSchema.parse(
        await (await fixture.request(`/v1/records/${record.id}`)).json(),
      );

      const posted = await fixture.request(
        `/v1/records/${record.id}/messages`,
        'POST',
        post('Wrong record', {
          transcriptionIds: [voice.id],
          expectedRecordRevision: current.recordRevision,
        }),
      );

      expect(posted.status).toBe(422);
      expect(await posted.json()).toMatchObject({
        code: 'EVIDENCE_INVALID',
        message: 'Ready transcription does not belong to record',
      });
      expect((await conversation(fixture, record.id)).items).toEqual([]);
      expect((await conversation(fixture, other.id)).items).toEqual([]);
    });
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

/**
 * snapshots record mutation surfaces around a message request and its worker
 * @param fixture real authenticated API runtime
 * @param recordId record whose apply boundary is under test
 */
async function messageRecordCounts(fixture: HttpFixture, recordId: string) {
  const db = fixture.runtime.database.db;

  return Promise.all([
    db.records.count({ where: { id: recordId } }),
    db.recordCategories.count({ where: { recordId } }),
    db.recordMaterials.count({ where: { recordId } }),
    db.recordMeasurements.count({ where: { recordId } }),
    db.recordTags.count({ where: { recordId } }),
    db.recordAcquisitions.count({ where: { recordId } }),
    db.editDraftAdoptionEvents.count({ where: { recordId } }),
  ]);
}

/**
 * snapshots all accepted-message side effects for a rollback assertion
 * @param fixture real authenticated API runtime
 * @param ownerId authenticated owner
 * @param recordId record whose request is rejected
 */
async function messageWriteCounts(
  fixture: HttpFixture,
  ownerId: string,
  recordId: string,
) {
  const db = fixture.runtime.database.db;

  return Promise.all([
    db.editDraftRuns.count({ where: { ownerId } }),
    db.jobs.count({ where: { ownerId } }),
    db.recordMessages.count({ where: { ownerId } }),
    messageRecordCounts(fixture, recordId),
  ]);
}

/**
 * creates located immutable source authority for saved and rejected-attachment scenarios
 * @param fixture authenticated API runtime
 * @param ownerId source owner
 */
async function seedMessageKnowledge(
  fixture: HttpFixture,
  ownerId: string,
): Promise<KnowledgeWriteV2['content']> {
  const db = fixture.runtime.database.db;
  const sourceId = randomUUID();
  const versionId = randomUUID();
  const citationId = randomUUID();
  const text = `Museum object ${sourceId} is porcelain, with tentative attribution.`;
  const source = {
    id: sourceId,
    versionId,
    title: 'Museum catalog',
    canonicalUrl: 'https://museum.example/object',
    languages: ['en'],
    contributors: [],
  };
  await db.sources.create({
    data: {
      id: sourceId,
      ownerId,
      kind: 'web',
      title: source.title,
      authorStatus: 'unknown',
      access: 'link_only',
    },
  });
  await db.sourceVersions.create({
    data: {
      id: versionId,
      sourceId,
      ownerId,
      sourceHash: createHash('sha256').update(text).digest('hex'),
      metadataSnapshot: {
        title: source.title,
        canonicalUrl: source.canonicalUrl,
        languages: source.languages,
        contributors: [],
      },
      capturedAt: '2026-10-19T00:00:00.000Z',
      status: 'registered',
      textIndexStatus: 'registered',
      imageIndexStatus: 'registered',
    },
  });
  await db.sourceLocators.create({
    data: {
      id: citationId,
      sourceId,
      sourceVersionId: versionId,
      kind: 'web',
      url: source.canonicalUrl,
      retrievedAt: '2026-10-19T00:00:00.000Z',
      excerptAsRetrieved: text,
    },
  });
  await db.citations.create({
    data: {
      id: citationId,
      locatorId: citationId,
      relation: 'supports',
      availability: 'link_only',
      verification: 'located',
    },
  });
  const review = { state: 'pending' as const };

  return {
    contentSchemaVersion: 2,
    entryType: 'object_example',
    origin: 'collector',
    titles: [{ language: 'en', text: 'Museum vase' }],
    aliases: [],
    sections: {
      summary: {
        claimKey: 'material',
        text,
        citationIds: [citationId],
        supportState: 'cited',
      },
      history: [],
      features: [],
      applicability: [],
      limits: [],
    },
    claims: [
      {
        claimKey: 'material',
        section: 'summary',
        ordinal: 0,
        originalText: text,
        originalLanguage: 'en',
        statementType: 'observation',
        scope: { object: ['Museum vase'] },
        qualifiers: {},
        uncertainty: 'Tentative attribution',
        supportState: 'cited',
        citationIds: [citationId],
        review,
        variants: [],
      },
    ],
    citations: [
      {
        id: citationId,
        relation: 'supports',
        availability: 'link_only',
        verification: 'located',
        quote: text,
        locator: {
          kind: 'web',
          id: citationId,
          sourceId,
          sourceVersionId: versionId,
          url: source.canonicalUrl,
          retrievedAt: '2026-10-19T00:00:00.000Z',
          excerpt: text,
        },
        source,
      },
    ],
    topics: [],
    images: [],
    methodIds: [],
    relatedEntryIds: [],
    editorialReview: review,
  };
}

describe('record messages frozen knowledge over HTTP', () => {
  it('should freeze POST attachments, preserve historical GET evidence, and write no record changes without apply', async ({
    fixture,
  }) => {
    const record = await createRecord(fixture);
    const db = fixture.runtime.database.db;
    const { ownerId } = await db.records.findUniqueOrThrow({
      where: { id: record.id },
    });
    const content = await seedMessageKnowledge(fixture, ownerId);
    const { transaction, clock, ids } = fixture.runtime;
    const knowledge = createKnowledgeService(transaction, clock, ids);
    const saved = await knowledge.createV2(ownerId, {
      requestKey: randomUUID(),
      expectedRevision: null,
      content,
      status: 'saved',
      reviewDecisions: [{ claimKey: 'material', state: 'reviewed' }],
      translationDecisions: [],
    });
    if (!saved.success) {
      throw new Error(saved.error.message);
    }
    const attachment = {
      entryId: saved.data.id,
      revision: 1,
      claimKey: 'material',
      citationIds: [content.citations[0]!.id],
    };
    const recordBefore = await db.records.findUniqueOrThrow({
      where: { id: record.id },
    });
    const countsBefore = await messageRecordCounts(fixture, record.id);
    const request = post(GROUNDED, { knowledgeAttachments: [attachment] });
    const response = await fixture.request(
      `/v1/records/${record.id}/messages`,
      'POST',
      request,
    );
    expect(response.status).toBe(202);
    const accepted = recordMessagePostedSchema.parse(await response.json());
    const draft = await db.editDraftRuns.findUniqueOrThrow({
      where: { id: accepted.editDraftId },
    });
    const frozen = knowledgeEvidenceSnapshotV1Schema.parse(
      draft.knowledgeContext,
    );
    expect(accepted.knowledgeSnapshot).toEqual({
      snapshotId: frozen.snapshotId,
      snapshotHash: frozen.snapshotHash,
    });
    expect(frozen.entries).toMatchObject([
      {
        entryId: saved.data.id,
        revision: 1,
        claims: [
          {
            statement: content.claims[0]!.originalText,
            language: 'en',
            uncertainty: 'Tentative attribution',
          },
        ],
      },
    ]);
    expect(await fixture.runtime.drain()).toMatchObject({
      settled: 1,
      failures: [],
    });
    const before = await conversation(fixture, record.id);
    const assistant = before.items.find((item) => item.author === 'assistant');
    expect(assistant).toMatchObject({
      knowledgeEvidence: frozen,
      answerSegments: [{ evidenceRefs: [attachment] }],
      draft: { proposedChanges: [] },
    });
    const changed = await knowledge.updateV2(ownerId, saved.data.id, {
      requestKey: randomUUID(),
      expectedRevision: 1,
      status: 'saved',
      content: {
        ...content,
        claims: content.claims.map((claim) => ({
          ...claim,
          uncertainty: 'Attribution now disputed',
        })),
      },
      reviewDecisions: [{ claimKey: 'material', state: 'reviewed' }],
      translationDecisions: [],
    });
    expect(changed.success).toBe(true);
    expect(await conversation(fixture, record.id)).toEqual(before);
    expect(await messageRecordCounts(fixture, record.id)).toEqual(countsBefore);
    expect(
      await db.records.findUniqueOrThrow({ where: { id: record.id } }),
    ).toEqual(recordBefore);
  });

  it('should reject foreign and unsaved POST attachments without draft, job, message or record writes', async ({
    fixture,
  }) => {
    const record = await createRecord(fixture);
    const db = fixture.runtime.database.db;
    const { ownerId } = await db.records.findUniqueOrThrow({
      where: { id: record.id },
    });
    const { transaction, clock, ids } = fixture.runtime;
    const knowledge = createKnowledgeService(transaction, clock, ids);
    for (const [entryOwner, status] of [
      [randomUUID(), 'saved'],
      [ownerId, 'draft'],
    ] as const) {
      const content = await seedMessageKnowledge(fixture, entryOwner);
      const saved = await knowledge.createV2(entryOwner, {
        requestKey: randomUUID(),
        expectedRevision: null,
        content,
        status,
        reviewDecisions: [{ claimKey: 'material', state: 'reviewed' }],
        translationDecisions: [],
      });
      if (!saved.success) {
        throw new Error(saved.error.message);
      }
      const before = await messageWriteCounts(fixture, ownerId, record.id);
      const response = await fixture.request(
        `/v1/records/${record.id}/messages`,
        'POST',
        post(GROUNDED, {
          knowledgeAttachments: [
            {
              entryId: saved.data.id,
              revision: 1,
              claimKey: 'material',
              citationIds: [content.citations[0]!.id],
            },
          ],
        }),
      );
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: 'EVIDENCE_INVALID' });
      expect(await messageWriteCounts(fixture, ownerId, record.id)).toEqual(
        before,
      );
    }
    expect((await conversation(fixture, record.id)).items).toEqual([]);
  });

  it('should save an unsupported reply after two actual no-output provider attempts with truthful audit and no record writes', async ({
    fixture,
  }) => {
    const record = await createRecord(fixture);
    const countsBefore = await messageRecordCounts(fixture, record.id);
    const callsBefore = noOutputCalls.count;
    const response = await fixture.request(
      `/v1/records/${record.id}/messages`,
      'POST',
      post(NO_OUTPUT),
    );
    expect(response.status).toBe(202);
    const accepted = recordMessagePostedSchema.parse(await response.json());
    expect(await fixture.runtime.drain()).toMatchObject({
      settled: 1,
      failures: [],
    });
    expect(noOutputCalls.count).toBe(callsBefore + 2);
    const draft =
      await fixture.runtime.database.db.editDraftRuns.findUniqueOrThrow({
        where: { id: accepted.editDraftId },
      });
    expect(draft.invocation).toMatchObject({
      role: 'recordEditing',
      provider: 'gateway',
      adapterKind: 'live',
      usage: { inputTokens: null, outputTokens: null },
      finishReason: null,
    });
    expect((await conversation(fixture, record.id)).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          author: 'assistant',
          body: knowledgeNoSupportedAnswer,
          answerSegments: [
            { text: knowledgeNoSupportedAnswer, evidenceRefs: [] },
          ],
          draft: expect.objectContaining({ proposedChanges: [] }),
        }),
      ]),
    );
    expect(await messageRecordCounts(fixture, record.id)).toEqual(countsBefore);
  });
});

describe('development record messages frozen knowledge over HTTP', () => {
  it('should answer an ordinary question and propose edits without saved knowledge', async ({
    fixture,
  }) => {
    const record = await createRecord(fixture);
    const before = await messageRecordCounts(fixture, record.id);
    for (const body of [PLAIN_QUESTION, PLAIN_EDIT]) {
      const response = await fixture.request(
        `/v1/records/${record.id}/messages`,
        'POST',
        post(body),
      );
      expect(response.status).toBe(202);
      expect(await fixture.runtime.drain()).toMatchObject({
        settled: 1,
        failures: [],
      });
    }
    const assistants = (await conversation(fixture, record.id)).items.filter(
      (message) => message.author === 'assistant',
    );
    expect(assistants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          body: expect.stringContaining('開發示範：這是提問'),
          draft: expect.objectContaining({ proposedChanges: [] }),
        }),
        expect.objectContaining({
          body: reply,
          draft: expect.objectContaining({
            proposedChanges: [
              expect.objectContaining({ field: 'description' }),
            ],
          }),
        }),
      ]),
    );
    expect(await messageRecordCounts(fixture, record.id)).toEqual(before);
  });

  it('should persist real development citations validated against the frozen POST context', async ({
    fixture,
  }) => {
    const record = await createRecord(fixture);
    const db = fixture.runtime.database.db;
    const { ownerId } = await db.records.findUniqueOrThrow({
      where: { id: record.id },
    });
    const content = await seedMessageKnowledge(fixture, ownerId);
    const { transaction, clock, ids } = fixture.runtime;
    const saved = await createKnowledgeService(
      transaction,
      clock,
      ids,
    ).createV2(ownerId, {
      requestKey: randomUUID(),
      expectedRevision: null,
      content,
      status: 'saved',
      reviewDecisions: [{ claimKey: 'material', state: 'reviewed' }],
      translationDecisions: [],
    });
    if (!saved.success) {
      throw new Error(saved.error.message);
    }
    const attachment = {
      entryId: saved.data.id,
      revision: saved.data.revision,
      claimKey: 'material',
      citationIds: [content.citations[0]!.id],
    };
    const recordBefore = await db.records.findUniqueOrThrow({
      where: { id: record.id },
    });

    const response = await fixture.request(
      `/v1/records/${record.id}/messages`,
      'POST',
      post(DEVELOPMENT_QUESTION, {
        knowledgeAttachments: [attachment],
      }),
    );

    expect(response.status).toBe(202);
    const accepted = recordMessagePostedSchema.parse(await response.json());
    const run = await db.editDraftRuns.findUniqueOrThrow({
      where: { id: accepted.editDraftId },
    });
    const frozen = knowledgeEvidenceSnapshotV1Schema.parse(
      run.knowledgeContext,
    );
    expect(await fixture.runtime.drain()).toMatchObject({
      settled: 1,
      failures: [],
    });
    const history = await conversation(fixture, record.id);
    const assistant = history.items.find(
      (message) => message.author === 'assistant',
    );
    expect(assistant).toBeDefined();
    expect(assistant!.knowledgeEvidence).toEqual(frozen);
    expect(
      assistant!.answerSegments?.flatMap((segment) => segment.evidenceRefs),
    ).toEqual([attachment]);
    expect(
      validateKnowledgeAnswerSegments(assistant!.answerSegments!, frozen),
    ).toBe(true);
    expect(assistant!.draft.proposedChanges).toEqual([]);
    expect(assistant!.body).toContain(content.claims[0]!.originalText);
    expect(assistant!.body).toContain('Tentative attribution');
    const completed = await db.editDraftRuns.findUniqueOrThrow({
      where: { id: accepted.editDraftId },
    });
    expect(completed.invocation).toMatchObject({
      adapterKind: 'development',
      role: 'recordEditing',
      citationCheck: { valid: true, rejectedReferenceIds: [] },
    });
    expect(
      await db.records.findUniqueOrThrow({ where: { id: record.id } }),
    ).toEqual(recordBefore);
  });
});
