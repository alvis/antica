import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  editDraftAcceptedSchema,
  editDraftDetailSchema,
  observationSchema,
  recordDetailSchema,
} from '@antica/contracts';

import { createHttpFixture } from '../fixtures/http.js';

let fixture: Awaited<ReturnType<typeof createHttpFixture>>;
beforeAll(async () => {
  fixture = await createHttpFixture();
}, 30_000);
afterAll(async () => {
  await fixture.close();
});

describe('fn:createVoiceRoutes', () => {
  it('should queue an edit from collector observations and adopt only the selected proposal', async () => {
    const record = recordDetailSchema.parse(
      await (
        await fixture.request(
          '/v1/records',
          'POST',
          { unitKind: 'single', name: 'Collector name' },
          randomUUID(),
        )
      ).json(),
    );
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
    const submitted = await fixture.request('/v1/edit-drafts', 'POST', {
      requestKey: randomUUID(),
      recordId: record.id,
      expectedRecordRevision: 2,
      transcriptionIds: [],
      observationIds: [observation.id],
      instructionZhHant: '整理描述',
    });
    expect(submitted.status).toBe(202);
    const accepted = editDraftAcceptedSchema.parse(await submitted.json());
    expect(await fixture.runtime.drain()).toMatchObject({
      settled: 1,
      failures: [],
    });
    const draft = editDraftDetailSchema.parse(
      await (
        await fixture.request(`/v1/edit-drafts/${accepted.editDraftId}`)
      ).json(),
    );
    expect(draft).toMatchObject({
      status: 'ready',
      result: { suggestedDescriptionZhHant: observation.text },
    });
    expect(
      await (await fixture.request(`/v1/records/${record.id}`)).json(),
    ).toMatchObject({ description: '', name: 'Collector name' });
    const applied = await fixture.request(
      `/v1/edit-drafts/${accepted.editDraftId}/apply`,
      'POST',
      {
        requestKey: randomUUID(),
        expectedDraftRevision: draft.revision,
        expectedRecordRevision: 2,
        selectedProposalIds: [draft.result!.proposedChanges[0]!.id],
      },
    );
    expect(applied.status).toBe(200);
    expect(await applied.json()).toMatchObject({
      record: { description: observation.text, name: 'Collector name' },
    });
  });

  it.each([
    '/v1/transcriptions',
    '/v1/transcriptions/missing/confirm',
    '/v1/edit-drafts',
    '/v1/edit-drafts/missing/apply',
  ])('should reject invalid voice commands at %s', async (path) => {
    const response = await fixture.request(path, 'POST', {});
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('should reject inaccessible transcription inputs and confirmations without inventing collector observations', async () => {
    const missing = randomUUID();
    const requested = await fixture.request('/v1/transcriptions', 'POST', {
      requestKey: randomUUID(),
      recordId: missing,
      audioAssetId: randomUUID(),
      expectedRecordRevision: 1,
      vocabularyHints: [],
    });
    expect(requested.status).toBe(404);
    expect(await requested.json()).toMatchObject({ code: 'NOT_FOUND' });
    const read = await fixture.request(`/v1/transcriptions/${missing}`);
    expect(read.status).toBe(404);
    expect(await read.json()).toMatchObject({ code: 'NOT_FOUND' });
    const confirmed = await fixture.request(
      `/v1/transcriptions/${missing}/confirm`,
      'POST',
      {
        requestKey: randomUUID(),
        expectedRevision: 1,
        expectedRecordRevision: 1,
        adoptedTextZhHant: 'Collector text',
        componentIds: [],
        evidenceAnchorIds: [],
        checkIds: [],
        observedAt: new Date().toISOString(),
      },
    );
    expect(confirmed.status).toBe(404);
    expect(await confirmed.json()).toMatchObject({ code: 'NOT_FOUND' });
    expect(await fixture.runtime.drain()).toMatchObject({ inspected: 0 });
  });
});
