import { describe, expect, it, vi } from 'vitest';

import { createResearchHandler, createResearchService } from './service.js';

import type {
  JobEnvelope,
  ModelInvocation,
  ModelSelection,
  NoteInput,
  ReferenceInput,
  ReferenceLink,
  ResearchDetail,
  ResearchDraft,
  ResearchRequest,
} from '@antica/contracts';
import type { SourceCitation } from '@antica/domain';

import type {
  CommandReceipt,
  IndexIdentity,
  ModelCatalogPort,
  OperationResult,
  PublicWebResearchPort,
  ResearchModelPort,
  RetrievalSnapshot,
  TextRetrievalPort,
  TransactionPort,
  UnitOfWork,
} from '../ports/index.js';

import type { ResearchHandlerParams } from './service.js';

const ownerId = 'collector-1';
const now = '2026-10-13T12:00:00.000Z';
const index: IndexIdentity = {
  embeddingModelId: 'embedding-1',
  dimensions: 3,
  indexVersion: 'v1',
};
const selection: ModelSelection = {
  role: 'research',
  modelId: 'research-1',
  profileVersion: 'v1',
};
const request: ResearchRequest = {
  requestKey: 'request-1',
  instructionZhHant: '研究花瓶',
  scope: 'curated_only',
  recordId: null,
  entryId: null,
  sourceIds: ['source-1'],
  preferNamedAuthors: true,
};
const pageCitation: SourceCitation = {
  id: 'citation-page',
  locator: {
    kind: 'page',
    sourceId: 'source-1',
    sourceVersionId: 'version-1',
    pageId: 'page-1',
    pageIndex: 0,
    printedPageLabel: '1',
    canonicalViewId: 'view-1',
    regionId: 'region-1',
    region: { kind: 'rect', x: 1, y: 2, width: 3, height: 4 },
    textRange: null,
  },
  relation: 'supports',
  availability: 'stored',
  verification: 'located',
};
const webCitation: SourceCitation = {
  id: 'citation-web',
  locator: {
    kind: 'web',
    sourceId: 'web-1',
    sourceVersionId: 'web-version-1',
    url: 'https://example.test/vase',
    retrievedAt: now,
    snapshotAssetId: null,
    blockId: null,
    excerptAsRetrieved: 'A public excerpt',
  },
  relation: 'background',
  availability: 'link_only',
  verification: 'located',
};
const citedParagraph = {
  textZhHant: '有來源的觀察',
  support: 'cited',
  citationIds: [pageCitation.id],
} satisfies NoteInput['paragraphs'][number];
const draft: ResearchDraft = {
  revision: 1,
  titleZhHant: '花瓶研究',
  paragraphs: [citedParagraph],
  citations: [pageCitation],
  unresolvedQuestionsZhHant: [],
};
const defaultDetail: ResearchDetail = {
  researchId: 'research-1',
  jobId: 'job-1',
  state: { kind: 'queued' },
  request,
  sourceIds: request.sourceIds,
  draft: null,
  notes: [],
  warningsZhHant: [],
};
const noteInput: NoteInput = {
  requestKey: 'note-request-1',
  researchId: defaultDetail.researchId,
  expectedDraftRevision: 1,
  titleZhHant: '收藏筆記',
  paragraphs: [citedParagraph],
  citations: [pageCitation],
  recordId: null,
  entryId: null,
};
const referenceInput: ReferenceInput = {
  requestKey: 'reference-request-1',
  expectedRecordRevision: 1,
  target: {
    recordId: 'record-1',
    checkId: null,
    observationId: null,
    evidenceAnchorId: null,
  },
  reference: {
    kind: 'source',
    locator: pageCitation.locator,
    referenceImageId: null,
  },
  comparisonId: null,
  noteZhHant: '比較器形',
};
const invocation: ModelInvocation = {
  requestedModelId: 'research-1',
  effectiveModelId: 'research-1',
  provider: 'test',
  providerModelVersion: null,
  adapterKind: 'development',
  capabilities: {
    textInput: true,
    imageInput: false,
    audioInput: false,
    structuredOutput: true,
    toolCalling: false,
  },
  role: 'research',
  profileVersion: 'v1',
  promptVersion: 'v1',
  schemaVersion: 'v1',
  effectiveOptions: {},
  latencyMs: 0,
  usage: { inputTokens: 0, outputTokens: 0 },
  finishReason: null,
  citationCheck: { valid: true, rejectedReferenceIds: [] },
};

function createFixture() {
  const details = new Map<string, ResearchDetail>([
    [defaultDetail.researchId, defaultDetail],
  ]);
  const records = new Map([
    ['record-1', { id: 'record-1', recordRevision: 1 }],
  ]);
  const entries = new Set(['entry-1']);
  const source = {
    source: {
      id: 'source-1',
      kind: 'book_pages',
      revision: 1,
      metadata: { canonicalUrl: null as string | null },
    },
    version: {
      id: 'version-1',
      retrievedAt: null as string | null,
      metadataSnapshot: { canonicalUrl: null as string | null },
    },
    regions: [
      {
        id: 'region-1',
        pageId: 'page-1',
        region:
          pageCitation.locator.kind === 'page'
            ? pageCitation.locator.region
            : null,
      },
    ],
    referenceImages: [{ id: 'image-1', locator: pageCitation.locator }],
  };
  const sources = new Map([['source-1', source]]);
  const pages = new Map([
    [
      'page-1',
      {
        id: 'page-1',
        sourceVersionId: 'version-1',
        pageIndex: 0,
        printedPageLabel: '1',
        view: { id: 'view-1' },
      },
    ],
  ]);
  const checks = new Map([
    ['check-1', { id: 'check-1', recordId: 'record-1' }],
  ]);
  const observations = new Map([
    ['observation-1', { id: 'observation-1', recordId: 'record-1' }],
  ]);
  const anchors = new Map([
    [
      'anchor-1',
      {
        id: 'anchor-1',
        recordId: 'record-1',
        originalAssetId: 'asset-1',
      },
    ],
  ]);
  const media = new Map([
    [
      'asset-1',
      {
        id: 'asset-1',
        owner: { kind: 'record', recordId: 'record-1' },
      },
    ],
  ]);
  const jobs = new Map<string, JobEnvelope>([
    [
      'job-1',
      {
        id: 'job-1',
        kind: 'research' as const,
        resourceId: 'research-1',
        state: { kind: 'queued' as const },
        createdAt: now,
        updatedAt: now,
        result: null,
      },
    ],
  ]);
  const receipts = new Map<string, CommandReceipt>();
  const snapshots = new Map<string, RetrievalSnapshot>();
  const references = new Map<string, ReferenceLink>();
  const createResearch = vi.fn(
    async (id: string, jobId: string, input: ResearchRequest) => {
      details.set(id, {
        ...defaultDetail,
        researchId: id,
        jobId,
        request: input,
        sourceIds: input.sourceIds,
      });
    },
  );
  const saveDetail = vi.fn(async (detail: ResearchDetail) => {
    details.set(detail.researchId, detail);
  });
  const saveSnapshot = vi.fn(async (snapshot: RetrievalSnapshot) => {
    snapshots.set(snapshot.id, snapshot);
  });
  const addNote = vi.fn(
    async (note: NonNullable<ResearchDetail['notes'][number]>) => {
      const detail = details.get(note.researchId);
      if (detail) {
        details.set(note.researchId, {
          ...detail,
          notes: [...detail.notes, note],
        });
      }
    },
  );
  const findReference = vi.fn(async (_recordId: string, identity: string) => {
    return references.get(identity) ?? null;
  });
  const addReference = vi.fn(async (link: ReferenceLink, identity: string) => {
    references.set(identity, link);
  });
  const bumpVersions = vi.fn(
    async (recordId: string, expectedRevision: number) => {
      const record = records.get(recordId);
      if (record?.recordRevision !== expectedRevision) {
        return null;
      }
      const versions = {
        recordRevision: expectedRevision + 1,
        analysisInputVersion: 2,
        evidenceVersion: 1,
      };
      records.set(recordId, {
        ...record,
        recordRevision: versions.recordRevision,
      });

      return versions;
    },
  );
  const updateJob = vi.fn(async (job: JobEnvelope) => {
    jobs.set(job.id, job);

    return true;
  });
  const restartFailed = vi.fn(async (id: string) => {
    const job = jobs.get(id);
    if (!job) {
      return false;
    }
    jobs.set(id, { ...job, state: { kind: 'queued' } });

    return true;
  });
  const commands = {
    get: vi.fn(
      async (_owner: string, operation: string, key: string) =>
        receipts.get(`${operation}:${key}`) ?? null,
    ),
    insert: vi.fn(async (receipt: CommandReceipt) => {
      receipts.set(`${receipt.operation}:${receipt.requestKey}`, receipt);
    }),
  };
  const research = {
    get: vi.fn(async (id: string) => details.get(id) ?? null),
    create: createResearch,
    saveDetail,
    getRetrievalSnapshot: vi.fn(
      async (id: string) => snapshots.get(id) ?? null,
    ),
    saveRetrievalSnapshot: saveSnapshot,
    addNote,
    findReference,
    addReference,
    queryReferences: vi.fn(
      async (_recordId: string, filters: { limit?: number }) => ({
        items: [...references.values()],
        nextCursor: filters.limit === 1 ? 'next' : null,
      }),
    ),
  };
  const repositories = {
    records: {
      get: vi.fn(async (id: string) => records.get(id) ?? null),
      bumpVersions,
    },
    knowledge: {
      get: vi.fn(async (id: string) => (entries.has(id) ? { id } : null)),
    },
    sources: {
      get: vi.fn(async (id: string, versionId?: string) => {
        const source = sources.get(id);

        return source && (!versionId || source.version.id === versionId)
          ? source
          : null;
      }),
      getPage: vi.fn(async (id: string) => pages.get(id) ?? null),
      create: vi.fn(async () => undefined),
      addVersion: vi.fn(async () => true),
      addCitation: vi.fn(async () => undefined),
    },
    evidence: {
      getCheck: vi.fn(async (id: string) => checks.get(id) ?? null),
      getObservation: vi.fn(async (id: string) => observations.get(id) ?? null),
      getAnchor: vi.fn(async (id: string) => anchors.get(id) ?? null),
    },
    media: { get: vi.fn(async (id: string) => media.get(id) ?? null) },
    research,
    jobs: {
      get: vi.fn(async (id: string) => jobs.get(id) ?? null),
      create: vi.fn(async (job: JobEnvelope) => {
        jobs.set(job.id, job);
      }),
      update: updateJob,
      restartFailed,
    },
    commands,
    outbox: { enqueue: vi.fn(async () => undefined) },
  };
  const unit = new Proxy({} as UnitOfWork, {
    get(_target, property) {
      if (property in repositories) {
        return Reflect.get(repositories, property);
      }
      throw new Error(`Unexpected repository: ${String(property)}`);
    },
  });
  const owners = vi.fn<(owner: string) => void>();
  const transaction: TransactionPort = {
    run: async <T extends OperationResult<unknown>>(
      owner: string,
      operation: (work: UnitOfWork) => Promise<T>,
    ): Promise<T> => {
      owners(owner);

      return operation(unit);
    },
  };
  let nextId = 0;
  const ids = { create: vi.fn(() => `id-${++nextId}`) };
  const service = createResearchService(transaction, { now: () => now }, ids);
  const snapshot: RetrievalSnapshot = {
    id: defaultDetail.researchId,
    index,
    citations: [pageCitation],
    text: [
      {
        citationId: pageCitation.id,
        contentAsRetrieved: 'Source text',
        sourceRegionId: 'region-1',
      },
    ],
    methods: [],
    createdAt: now,
  };
  const text = {
    search: vi.fn(async () => ({
      success: true as const,
      data: { items: [], nextCursor: null },
    })),
    snapshot: vi.fn<TextRetrievalPort['snapshot']>(async () => ({
      success: true,
      data: snapshot,
    })),
  } satisfies TextRetrievalPort;
  const web = {
    search: vi.fn<PublicWebResearchPort['search']>(async () => ({
      success: true,
      data: [] as readonly SourceCitation[],
    })),
  } satisfies PublicWebResearchPort;
  const model = {
    draft: vi.fn<ResearchModelPort['draft']>(async () => ({
      success: true,
      data: { value: draft, invocation },
    })),
  } satisfies ResearchModelPort;
  const catalog = {
    resolve: vi.fn<ModelCatalogPort['resolve']>(async () => ({
      success: true,
      data: {
        effectiveModelId: 'research-1',
        capabilities: {
          textInput: true,
          imageInput: false,
          audioInput: false,
          structuredOutput: true,
          toolCalling: false,
        },
      },
    })),
  } satisfies ModelCatalogPort;
  const params: ResearchHandlerParams = {
    transaction,
    text,
    web,
    model,
    catalog,
    index,
    selection,
    clock: { now: () => now },
    ids,
  };
  const handler = createResearchHandler(params);

  return {
    service,
    handler,
    params,
    owners,
    details,
    records,
    entries,
    sources,
    pages,
    checks,
    observations,
    anchors,
    media,
    jobs,
    receipts,
    snapshots,
    repositories,
    text,
    web,
    model,
    catalog,
    ids,
  };
}

describe('fn:createResearchService', () => {
  it('should queue selected curated research once and replay an equivalent request', async () => {
    const fixture = createFixture();
    const first = await fixture.service.submit(ownerId, request);
    const replay = await fixture.service.submit(ownerId, {
      ...request,
      sourceIds: ['source-1'],
    });

    expect(first).toMatchObject({
      success: true,
      data: {
        researchId: 'id-1',
        jobId: 'id-2',
      },
    });
    expect(replay).toEqual(first);
    expect(fixture.jobs.get('id-2')).toMatchObject({
      kind: 'research',
      resourceId: 'id-1',
      state: { kind: 'queued' },
    });
    expect(fixture.repositories.jobs.create).toHaveBeenCalledTimes(1);
    expect(fixture.repositories.outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'research',
        event: expect.objectContaining({
          ownerId,
          idempotencyKey: request.requestKey,
        }),
      }),
    );
    expect(fixture.receipts.get('research.submit:request-1')).toMatchObject({
      status: 202,
    });
    expect(fixture.owners).toHaveBeenCalledWith(ownerId);
  });

  it('should reject changed replay keys and invalid source selections before queuing', async () => {
    const fixture = createFixture();
    await fixture.service.submit(ownerId, request);
    expect(
      await fixture.service.submit(ownerId, {
        ...request,
        instructionZhHant: '另一問題',
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(
      await fixture.service.submit(ownerId, {
        ...request,
        requestKey: 'empty',
        sourceIds: [],
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(
      await fixture.service.submit(ownerId, {
        ...request,
        requestKey: 'duplicate',
        sourceIds: ['source-1', 'source-1'],
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(fixture.repositories.jobs.create).toHaveBeenCalledTimes(1);
  });

  it('should resolve optional record and knowledge targets and reject unavailable sources', async () => {
    const fixture = createFixture();
    expect(
      await fixture.service.submit(ownerId, {
        ...request,
        requestKey: 'missing-record',
        recordId: 'missing',
      }),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(
      await fixture.service.submit(ownerId, {
        ...request,
        requestKey: 'missing-entry',
        entryId: 'missing',
      }),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(
      await fixture.service.submit(ownerId, {
        ...request,
        requestKey: 'missing-source',
        sourceIds: ['missing'],
      }),
    ).toMatchObject({ success: false, error: { code: 'SOURCE_UNAVAILABLE' } });
    expect(
      await fixture.service.submit(ownerId, {
        ...request,
        requestKey: 'linked',
        recordId: 'record-1',
        entryId: 'entry-1',
      }),
    ).toMatchObject({ success: true });
    expect(fixture.repositories.jobs.create).toHaveBeenCalledTimes(1);
  });

  it('should return saved research and report an absent draft', async () => {
    const fixture = createFixture();
    expect(await fixture.service.get(ownerId, 'research-1')).toEqual({
      success: true,
      data: defaultDetail,
    });
    expect(await fixture.service.get(ownerId, 'missing')).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await fixture.service.saveNote(ownerId, noteInput)).toMatchObject({
      success: false,
      error: { code: 'SOURCE_UNAVAILABLE' },
    });
  });

  it('should save an attributed note once, replay it, and reject a changed replay', async () => {
    const fixture = createFixture();
    fixture.details.set('research-1', { ...defaultDetail, draft });
    const first = await fixture.service.saveNote(ownerId, noteInput);
    const replay = await fixture.service.saveNote(ownerId, noteInput);
    const conflict = await fixture.service.saveNote(ownerId, {
      ...noteInput,
      titleZhHant: '不同筆記',
    });

    expect(first).toMatchObject({
      success: true,
      data: {
        researchId: 'research-1',
        savedBy: 'collector',
        titleZhHant: '收藏筆記',
        citations: [pageCitation],
      },
    });
    expect(replay).toEqual(first);
    expect(conflict).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(fixture.repositories.research.addNote).toHaveBeenCalledTimes(1);
    expect(fixture.receipts.get('notes.create:note-request-1')).toMatchObject({
      status: 201,
    });
  });

  it('should reject absent research, stale drafts, and missing linked targets', async () => {
    const fixture = createFixture();
    fixture.details.set('research-1', { ...defaultDetail, draft });
    expect(
      await fixture.service.saveNote(ownerId, {
        ...noteInput,
        researchId: 'missing',
      }),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(
      await fixture.service.saveNote(ownerId, {
        ...noteInput,
        expectedDraftRevision: 2,
      }),
    ).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT', retryable: true },
    });
    expect(
      await fixture.service.saveNote(ownerId, {
        ...noteInput,
        recordId: 'missing',
      }),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(
      await fixture.service.saveNote(ownerId, {
        ...noteInput,
        entryId: 'missing',
      }),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(
      await fixture.service.saveNote(ownerId, {
        ...noteInput,
        recordId: 'record-1',
        entryId: 'entry-1',
      }),
    ).toMatchObject({ success: true });
  });

  it('should reject citation substitutions and unsupported paragraph markers', async () => {
    const fixture = createFixture();
    fixture.details.set('research-1', { ...defaultDetail, draft });
    expect(
      await fixture.service.saveNote(ownerId, {
        ...noteInput,
        citations: [{ ...pageCitation, relation: 'background' }],
      }),
    ).toMatchObject({ success: false, error: { code: 'SOURCE_UNAVAILABLE' } });
    expect(
      await fixture.service.saveNote(ownerId, {
        ...noteInput,
        citations: [{ ...pageCitation, id: 'other' }],
      }),
    ).toMatchObject({ success: false, error: { code: 'SOURCE_UNAVAILABLE' } });
    expect(
      await fixture.service.saveNote(ownerId, {
        ...noteInput,
        paragraphs: [{ ...citedParagraph, citationIds: [] }],
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(
      await fixture.service.saveNote(ownerId, {
        ...noteInput,
        paragraphs: [{ ...citedParagraph, citationIds: ['missing'] }],
      }),
    ).toMatchObject({ success: false, error: { code: 'SOURCE_UNAVAILABLE' } });
    expect(fixture.repositories.research.addNote).not.toHaveBeenCalled();
  });
});

describe('fn:createResearchService references', () => {
  it('should save a source reference with a new record version and replay it', async () => {
    const fixture = createFixture();
    const first = await fixture.service.addReference(ownerId, referenceInput);
    const replay = await fixture.service.addReference(ownerId, referenceInput);

    expect(first).toMatchObject({
      success: true,
      data: {
        target: referenceInput.target,
        reference: referenceInput.reference,
        versions: {
          recordRevision: 2,
          analysisInputVersion: 2,
          evidenceVersion: 1,
        },
      },
    });
    expect(replay).toEqual(first);
    expect(fixture.repositories.records.bumpVersions).toHaveBeenCalledWith(
      'record-1',
      1,
      { analysisInput: true, evidence: false },
    );
    expect(fixture.repositories.research.addReference).toHaveBeenCalledTimes(1);
    expect(
      fixture.receipts.get('references.create:reference-request-1'),
    ).toMatchObject({ status: 201 });
  });

  it('should reject a changed request key and a missing target record', async () => {
    const fixture = createFixture();
    await fixture.service.addReference(ownerId, referenceInput);
    expect(
      await fixture.service.addReference(ownerId, {
        ...referenceInput,
        noteZhHant: '另一描述',
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(
      await fixture.service.addReference(ownerId, {
        ...referenceInput,
        requestKey: 'missing-target',
        target: {
          ...referenceInput.target,
          recordId: 'missing',
        },
      }),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(fixture.repositories.research.addReference).toHaveBeenCalledTimes(1);
  });

  it('should return an existing identity without advancing record versions', async () => {
    const fixture = createFixture();
    const first = await fixture.service.addReference(ownerId, referenceInput);
    const second = await fixture.service.addReference(ownerId, {
      ...referenceInput,
      requestKey: 'second-key',
      expectedRecordRevision: 1,
    });

    expect(second).toEqual(first);
    expect(fixture.repositories.records.bumpVersions).toHaveBeenCalledTimes(1);
    expect(fixture.receipts.get('references.create:second-key')).toMatchObject({
      status: 200,
    });
  });

  it('should reject stale record versions and a failed compare-and-swap', async () => {
    const stale = createFixture();
    expect(
      await stale.service.addReference(ownerId, {
        ...referenceInput,
        expectedRecordRevision: 2,
      }),
    ).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT', retryable: true },
    });
    expect(stale.repositories.research.addReference).not.toHaveBeenCalled();

    const raced = createFixture();
    raced.repositories.records.bumpVersions.mockResolvedValueOnce(null);
    expect(
      await raced.service.addReference(ownerId, referenceInput),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
    expect(raced.repositories.research.addReference).not.toHaveBeenCalled();
  });

  it('should validate target checks, observations, and anchors against the record', async () => {
    const fixture = createFixture();
    const targets = [
      { checkId: 'check-1' },
      { observationId: 'observation-1' },
      { evidenceAnchorId: 'anchor-1' },
    ];
    for (const [index, target] of targets.entries()) {
      expect(
        await fixture.service.addReference(ownerId, {
          ...referenceInput,
          requestKey: `target-${index}`,
          expectedRecordRevision: index + 1,
          target: {
            ...referenceInput.target,
            ...target,
          },
        }),
      ).toMatchObject({ success: true });
    }
    expect(fixture.repositories.research.addReference).toHaveBeenCalledTimes(3);
  });

  it('should reject missing and foreign target evidence before saving', async () => {
    const fixture = createFixture();
    const targetCases = [
      { checkId: 'missing' },
      { checkId: 'foreign-check' },
      { observationId: 'missing' },
      { observationId: 'foreign-observation' },
      { evidenceAnchorId: 'missing' },
      { evidenceAnchorId: 'foreign-anchor' },
    ];
    fixture.checks.set('foreign-check', {
      id: 'foreign-check',
      recordId: 'other',
    });
    fixture.observations.set('foreign-observation', {
      id: 'foreign-observation',
      recordId: 'other',
    });
    fixture.anchors.set('foreign-anchor', {
      id: 'foreign-anchor',
      recordId: 'other',
      originalAssetId: 'asset-1',
    });
    for (const [index, target] of targetCases.entries()) {
      expect(
        await fixture.service.addReference(ownerId, {
          ...referenceInput,
          requestKey: `invalid-target-${index}`,
          target: {
            ...referenceInput.target,
            ...target,
          },
        }),
      ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    }
    expect(fixture.repositories.records.bumpVersions).not.toHaveBeenCalled();
  });

  it('should validate a collection reference against its record, media, and anchor', async () => {
    const fixture = createFixture();
    const reference: ReferenceInput['reference'] = {
      kind: 'collection',
      recordId: 'record-1',
      originalAssetId: 'asset-1',
      evidenceAnchorId: 'anchor-1',
    };
    expect(
      await fixture.service.addReference(ownerId, {
        ...referenceInput,
        reference,
      }),
    ).toMatchObject({ success: true, data: { reference } });
    const withoutAnchor = createFixture();
    expect(
      await withoutAnchor.service.addReference(ownerId, {
        ...referenceInput,
        reference: { ...reference, evidenceAnchorId: null },
      }),
    ).toMatchObject({ success: true });
  });

  it('should reject missing or foreign collection media and mismatched anchors', async () => {
    const fixture = createFixture();
    const collection: ReferenceInput['reference'] = {
      kind: 'collection',
      recordId: 'record-1',
      originalAssetId: 'asset-1',
      evidenceAnchorId: null,
    };
    expect(
      await fixture.service.addReference(ownerId, {
        ...referenceInput,
        reference: { ...collection, recordId: 'missing' },
      }),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture.service.addReference(ownerId, {
        ...referenceInput,
        reference: { ...collection, originalAssetId: 'missing' },
      }),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    fixture.media.set('foreign', {
      id: 'foreign',
      owner: { kind: 'record', recordId: 'other' },
    });
    expect(
      await fixture.service.addReference(ownerId, {
        ...referenceInput,
        reference: { ...collection, originalAssetId: 'foreign' },
      }),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture.service.addReference(ownerId, {
        ...referenceInput,
        reference: { ...collection, evidenceAnchorId: 'missing' },
      }),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    fixture.anchors.set('foreign', {
      id: 'foreign',
      recordId: 'other',
      originalAssetId: 'asset-1',
    });
    expect(
      await fixture.service.addReference(ownerId, {
        ...referenceInput,
        reference: { ...collection, evidenceAnchorId: 'foreign' },
      }),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    fixture.anchors.set('other-asset', {
      id: 'other-asset',
      recordId: 'record-1',
      originalAssetId: 'foreign',
    });
    expect(
      await fixture.service.addReference(ownerId, {
        ...referenceInput,
        reference: { ...collection, evidenceAnchorId: 'other-asset' },
      }),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(fixture.repositories.research.addReference).not.toHaveBeenCalled();
  });

  it('should accept a page region and source image with their saved identities', async () => {
    const fixture = createFixture();
    expect(
      await fixture.service.addReference(ownerId, {
        ...referenceInput,
        reference: {
          kind: 'source',
          locator: pageCitation.locator,
          referenceImageId: 'image-1',
        },
      }),
    ).toMatchObject({ success: true });
    const withoutRegion = createFixture();
    if (pageCitation.locator.kind !== 'page') {
      throw new Error('Expected page citation fixture');
    }
    expect(
      await withoutRegion.service.addReference(ownerId, {
        ...referenceInput,
        reference: {
          kind: 'source',
          locator: { ...pageCitation.locator, regionId: null, region: null },
          referenceImageId: null,
        },
      }),
    ).toMatchObject({ success: true });
  });

  it('should reject missing versions, pages, regions, and source images', async () => {
    const fixture = createFixture();
    const page = pageCitation.locator;
    if (page.kind !== 'page') {
      throw new Error('Expected page citation fixture');
    }
    const cases: Array<ReferenceInput['reference']> = [
      {
        kind: 'source',
        locator: { ...page, sourceId: 'missing' },
        referenceImageId: null,
      },
      {
        kind: 'source',
        locator: { ...page, sourceVersionId: 'other' },
        referenceImageId: null,
      },
      {
        kind: 'source',
        locator: { ...page, pageId: 'missing' },
        referenceImageId: null,
      },
      {
        kind: 'source',
        locator: { ...page, pageIndex: 1 },
        referenceImageId: null,
      },
      {
        kind: 'source',
        locator: { ...page, printedPageLabel: '2' },
        referenceImageId: null,
      },
      {
        kind: 'source',
        locator: { ...page, canonicalViewId: 'other' },
        referenceImageId: null,
      },
      {
        kind: 'source',
        locator: { ...page, regionId: 'missing' },
        referenceImageId: null,
      },
      {
        kind: 'source',
        locator: {
          ...page,
          region: { kind: 'rect', x: 9, y: 2, width: 3, height: 4 },
        },
        referenceImageId: null,
      },
      { kind: 'source', locator: page, referenceImageId: 'missing' },
    ];
    for (const [index, reference] of cases.entries()) {
      expect(
        await fixture.service.addReference(ownerId, {
          ...referenceInput,
          requestKey: `invalid-page-${index}`,
          reference,
        }),
      ).toMatchObject({ success: false });
    }
    expect(fixture.repositories.research.addReference).not.toHaveBeenCalled();
  });

  it('should validate a web locator and reject a source URL or retrieval mismatch', async () => {
    const fixture = createFixture();
    fixture.sources.set('web-1', {
      ...fixture.sources.get('source-1')!,
      source: {
        id: 'web-1',
        kind: 'web',
        revision: 1,
        metadata: { canonicalUrl: 'https://example.test/vase' },
      },
      version: {
        id: 'web-version-1',
        retrievedAt: now,
        metadataSnapshot: { canonicalUrl: 'https://example.test/vase' },
      },
    });
    expect(
      await fixture.service.addReference(ownerId, {
        ...referenceInput,
        reference: {
          kind: 'source',
          locator: webCitation.locator,
          referenceImageId: null,
        },
      }),
    ).toMatchObject({ success: true });
    const web = webCitation.locator;
    if (web.kind !== 'web') {
      throw new Error('Expected web citation fixture');
    }
    for (const [index, locator] of [
      { ...web, retrievedAt: '2026-10-12T12:00:00.000Z' },
      { ...web, url: 'https://other.test/vase' },
    ].entries()) {
      expect(
        await fixture.service.addReference(ownerId, {
          ...referenceInput,
          requestKey: `invalid-web-${index}`,
          reference: {
            kind: 'source',
            locator,
            referenceImageId: null,
          },
        }),
      ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    }
    expect(
      await fixture.service.addReference(ownerId, {
        ...referenceInput,
        requestKey: 'book-as-web',
        reference: {
          kind: 'source',
          locator: {
            ...web,
            sourceId: 'source-1',
            sourceVersionId: 'version-1',
          },
          referenceImageId: null,
        },
      }),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
  });

  it('should list only a record’s references with valid evidence filters and a default limit', async () => {
    const fixture = createFixture();
    await fixture.service.addReference(ownerId, referenceInput);
    expect(
      await fixture.service.listReferences(ownerId, 'record-1', {
        checkId: 'check-1',
        observationId: 'observation-1',
      }),
    ).toMatchObject({
      success: true,
      data: {
        items: [expect.objectContaining({ target: referenceInput.target })],
      },
    });
    expect(fixture.repositories.research.queryReferences).toHaveBeenCalledWith(
      'record-1',
      { checkId: 'check-1', observationId: 'observation-1', limit: 50 },
    );
    expect(
      await fixture.service.listReferences(ownerId, 'record-1', {
        limit: 1,
        cursor: 'cursor-1',
      }),
    ).toMatchObject({ success: true, data: { nextCursor: 'next' } });
    expect(fixture.repositories.research.queryReferences).toHaveBeenCalledWith(
      'record-1',
      { limit: 1, cursor: 'cursor-1' },
    );
  });

  it('should reject missing records and missing or foreign list filters', async () => {
    const fixture = createFixture();
    expect(
      await fixture.service.listReferences(ownerId, 'missing', {}),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    fixture.checks.set('foreign', { id: 'foreign', recordId: 'other' });
    fixture.observations.set('foreign', { id: 'foreign', recordId: 'other' });
    for (const filters of [
      { checkId: 'missing' },
      { checkId: 'foreign' },
      { observationId: 'missing' },
      { observationId: 'foreign' },
    ]) {
      expect(
        await fixture.service.listReferences(ownerId, 'record-1', filters),
      ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    }
    expect(
      fixture.repositories.research.queryReferences,
    ).not.toHaveBeenCalled();
  });
});

describe('fn:createResearchHandler', () => {
  it('should freeze selected curated text and save a cited draft', async () => {
    const fixture = createFixture();
    const result = await fixture.handler(ownerId, 'job-1');

    expect(result).toEqual({ success: true, data: undefined });
    expect(fixture.details.get('research-1')).toMatchObject({
      state: { kind: 'succeeded' },
      sourceIds: ['source-1'],
      draft,
    });
    expect(fixture.snapshots.get('research-1')).toMatchObject({
      citations: [pageCitation],
      text: [{ citationId: pageCitation.id }],
    });
    expect(fixture.model.draft).toHaveBeenCalledWith(
      request,
      {
        citations: [pageCitation],
        text: [
          {
            citationId: pageCitation.id,
            contentAsRetrieved: 'Source text',
            sourceRegionId: 'region-1',
          },
        ],
      },
      selection,
    );
    expect(fixture.jobs.get('job-1')).toMatchObject({
      state: { kind: 'succeeded' },
    });
    expect(fixture.owners).toHaveBeenCalledWith(ownerId);
  });

  it('should ignore already completed research without invoking a provider', async () => {
    for (const state of [
      { kind: 'succeeded' as const, completedAt: now },
      {
        kind: 'partial' as const,
        completedAt: now,
        incompleteStages: ['public_web'],
      },
    ]) {
      const fixture = createFixture();
      fixture.details.set('research-1', { ...defaultDetail, state });
      expect(await fixture.handler(ownerId, 'job-1')).toEqual({
        success: true,
        data: undefined,
      });
      expect(fixture.catalog.resolve).not.toHaveBeenCalled();
      expect(fixture.model.draft).not.toHaveBeenCalled();
    }
  });

  it('should reject missing jobs, wrong job kinds, and missing research', async () => {
    const fixture = createFixture();
    expect(await fixture.handler(ownerId, 'missing')).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
    fixture.jobs.set('wrong-kind', {
      ...fixture.jobs.get('job-1')!,
      id: 'wrong-kind',
      kind: 'analysis',
    });
    expect(await fixture.handler(ownerId, 'wrong-kind')).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
    fixture.details.delete('research-1');
    expect(await fixture.handler(ownerId, 'job-1')).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(fixture.catalog.resolve).not.toHaveBeenCalled();
  });

  it('should restart failed research before redrafting and reject a retry race', async () => {
    const fixture = createFixture();
    fixture.details.set('research-1', {
      ...defaultDetail,
      state: {
        kind: 'failed',
        error: {
          code: 'SOURCE_UNAVAILABLE',
          message: 'Unavailable',
          retryable: true,
          requestId: 'error-1',
        },
      },
    });
    expect(await fixture.handler(ownerId, 'job-1')).toEqual({
      success: true,
      data: undefined,
    });
    expect(fixture.repositories.jobs.restartFailed).toHaveBeenCalledWith(
      'job-1',
      now,
      now,
    );
    const raced = createFixture();
    raced.details.set('research-1', {
      ...defaultDetail,
      state: {
        kind: 'failed',
        error: {
          code: 'SOURCE_UNAVAILABLE',
          message: 'Unavailable',
          retryable: true,
          requestId: 'error-1',
        },
      },
    });
    raced.repositories.jobs.restartFailed.mockResolvedValueOnce(false);
    expect(await raced.handler(ownerId, 'job-1')).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT' },
    });
    expect(raced.catalog.resolve).not.toHaveBeenCalled();
  });

  it('should redraft from a persisted snapshot without fresh retrieval', async () => {
    const fixture = createFixture();
    fixture.snapshots.set('research-1', {
      id: 'research-1',
      index,
      citations: [pageCitation],
      text: [
        {
          citationId: pageCitation.id,
          contentAsRetrieved: 'Frozen text',
          sourceRegionId: 'region-1',
        },
      ],
      methods: [],
      createdAt: now,
    });
    expect(await fixture.handler(ownerId, 'job-1')).toEqual({
      success: true,
      data: undefined,
    });
    expect(fixture.text.snapshot).not.toHaveBeenCalled();
    expect(fixture.web.search).not.toHaveBeenCalled();
    expect(fixture.model.draft).toHaveBeenCalledWith(
      request,
      {
        citations: [pageCitation],
        text: [
          {
            citationId: pageCitation.id,
            contentAsRetrieved: 'Frozen text',
            sourceRegionId: 'region-1',
          },
        ],
      },
      selection,
    );
  });

  it('should filter unrelated curated citations and text from the frozen pack', async () => {
    const fixture = createFixture();
    const otherCitation = {
      ...pageCitation,
      id: 'other-citation',
      locator: { ...pageCitation.locator, sourceId: 'other-source' },
    };
    fixture.text.snapshot.mockResolvedValueOnce({
      success: true,
      data: {
        id: 'research-1',
        index,
        citations: [pageCitation, otherCitation],
        text: [
          {
            citationId: pageCitation.id,
            contentAsRetrieved: 'Allowed',
            sourceRegionId: null,
          },
          {
            citationId: otherCitation.id,
            contentAsRetrieved: 'Unselected',
            sourceRegionId: null,
          },
        ],
        methods: [],
        createdAt: now,
      },
    });
    expect(await fixture.handler(ownerId, 'job-1')).toEqual({
      success: true,
      data: undefined,
    });
    expect(fixture.snapshots.get('research-1')).toMatchObject({
      citations: [pageCitation],
      text: [{ citationId: pageCitation.id }],
    });
  });

  it('should draft public web excerpts without a curated retrieval call', async () => {
    const fixture = createFixture();
    fixture.details.set('research-1', {
      ...defaultDetail,
      request: {
        ...request,
        scope: 'curated_and_public_web',
        sourceIds: [],
      },
    });
    fixture.web.search.mockResolvedValueOnce({
      success: true,
      data: [webCitation],
    });
    fixture.model.draft.mockResolvedValueOnce({
      success: true,
      data: {
        value: {
          ...draft,
          citations: [webCitation],
          paragraphs: [
            {
              ...citedParagraph,
              citationIds: [webCitation.id],
            },
          ],
        },
        invocation,
      },
    });
    expect(await fixture.handler(ownerId, 'job-1')).toEqual({
      success: true,
      data: undefined,
    });
    expect(fixture.text.snapshot).not.toHaveBeenCalled();
    expect(fixture.web.search).toHaveBeenCalledWith(request.instructionZhHant);
    expect(fixture.snapshots.get('research-1')).toMatchObject({
      citations: [webCitation],
      text: [
        { citationId: webCitation.id, contentAsRetrieved: 'A public excerpt' },
      ],
    });
    expect(fixture.repositories.sources.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'web',
        metadata: expect.objectContaining({
          canonicalUrl: 'https://example.test/vase',
          access: 'link_only',
        }),
      }),
      expect.objectContaining({
        sourceId: 'web-1',
        originalAssetIds: [],
        metadataSnapshot: expect.objectContaining({ access: 'link_only' }),
      }),
      [],
    );
    expect(fixture.repositories.sources.addCitation).toHaveBeenCalledWith(
      webCitation,
    );
  });

  it('should retain a web citation with no usable excerpt without adding unsupported text', async () => {
    const fixture = createFixture();
    fixture.details.set('research-1', {
      ...defaultDetail,
      request: {
        ...request,
        scope: 'curated_and_public_web',
      },
    });
    const web = webCitation.locator;
    if (web.kind !== 'web') {
      throw new Error('Expected web citation fixture');
    }
    const citation = {
      ...webCitation,
      locator: {
        ...web,
        excerptAsRetrieved: '   ',
      },
    } satisfies SourceCitation;
    fixture.web.search.mockResolvedValueOnce({
      success: true,
      data: [citation],
    });
    expect(await fixture.handler(ownerId, 'job-1')).toEqual({
      success: true,
      data: undefined,
    });
    expect(fixture.snapshots.get('research-1')).toMatchObject({
      citations: [pageCitation, citation],
      text: [{ citationId: pageCitation.id }],
    });
  });

  it('should save a partial draft when the web provider fails after curated retrieval', async () => {
    const fixture = createFixture();
    fixture.details.set('research-1', {
      ...defaultDetail,
      request: {
        ...request,
        scope: 'curated_and_public_web',
      },
    });
    fixture.web.search.mockResolvedValueOnce({
      success: false,
      error: {
        code: 'SOURCE_UNAVAILABLE',
        message: 'Web unavailable',
        retryable: true,
      },
    });
    expect(await fixture.handler(ownerId, 'job-1')).toEqual({
      success: true,
      data: undefined,
    });
    expect(fixture.details.get('research-1')).toMatchObject({
      state: { kind: 'partial', incompleteStages: ['public_web'] },
      warningsZhHant: [expect.any(String)],
    });
    expect(fixture.snapshots.get('research-1')).toMatchObject({
      citations: [pageCitation],
    });
  });

  it('should fail research when web retrieval has no curated text to retain', async () => {
    const fixture = createFixture();
    fixture.details.set('research-1', {
      ...defaultDetail,
      request: {
        ...request,
        scope: 'curated_and_public_web',
        sourceIds: [],
      },
    });
    fixture.web.search.mockResolvedValueOnce({
      success: false,
      error: {
        code: 'SOURCE_UNAVAILABLE',
        message: 'Web unavailable',
        retryable: true,
      },
    });
    expect(await fixture.handler(ownerId, 'job-1')).toMatchObject({
      success: false,
      error: { code: 'SOURCE_UNAVAILABLE' },
    });
    expect(fixture.details.get('research-1')).toMatchObject({
      state: { kind: 'failed' },
    });
    expect(fixture.model.draft).not.toHaveBeenCalled();
  });

  it('should persist a new web version for a matching saved URL', async () => {
    const fixture = createFixture();
    fixture.details.set('research-1', {
      ...defaultDetail,
      request: {
        ...request,
        scope: 'curated_and_public_web',
      },
    });
    fixture.web.search.mockResolvedValueOnce({
      success: true,
      data: [webCitation],
    });
    fixture.sources.set('web-1', {
      ...fixture.sources.get('source-1')!,
      source: {
        id: 'web-1',
        kind: 'web',
        revision: 2,
        metadata: { canonicalUrl: 'https://example.test/vase' },
      },
    });
    expect(await fixture.handler(ownerId, 'job-1')).toEqual({
      success: true,
      data: undefined,
    });
    expect(fixture.repositories.sources.addVersion).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'web-version-1', sourceId: 'web-1' }),
      2,
      [],
    );
    expect(fixture.repositories.sources.create).not.toHaveBeenCalled();
  });

  it('should reuse an already saved web version while registering its citation', async () => {
    const fixture = createFixture();
    fixture.details.set('research-1', {
      ...defaultDetail,
      request: {
        ...request,
        scope: 'curated_and_public_web',
      },
    });
    fixture.web.search.mockResolvedValueOnce({
      success: true,
      data: [webCitation],
    });
    fixture.sources.set('web-1', {
      ...fixture.sources.get('source-1')!,
      source: {
        id: 'web-1',
        kind: 'web',
        revision: 2,
        metadata: { canonicalUrl: 'https://example.test/vase' },
      },
      version: {
        id: 'web-version-1',
        retrievedAt: now,
        metadataSnapshot: { canonicalUrl: 'https://example.test/vase' },
      },
    });
    expect(await fixture.handler(ownerId, 'job-1')).toEqual({
      success: true,
      data: undefined,
    });
    expect(fixture.repositories.sources.create).not.toHaveBeenCalled();
    expect(fixture.repositories.sources.addVersion).not.toHaveBeenCalled();
    expect(fixture.repositories.sources.addCitation).toHaveBeenCalledWith(
      webCitation,
    );
  });

  it('should reject web source identity collisions and version races', async () => {
    const fixture = createFixture();
    fixture.details.set('research-1', {
      ...defaultDetail,
      request: {
        ...request,
        scope: 'curated_and_public_web',
      },
    });
    fixture.web.search.mockResolvedValueOnce({
      success: true,
      data: [webCitation],
    });
    fixture.sources.set('web-1', {
      ...fixture.sources.get('source-1')!,
      source: {
        id: 'web-1',
        kind: 'book_pages',
        revision: 2,
        metadata: { canonicalUrl: null },
      },
    });
    expect(await fixture.handler(ownerId, 'job-1')).toMatchObject({
      success: false,
      error: { code: 'SOURCE_UNAVAILABLE' },
    });
    expect(fixture.model.draft).not.toHaveBeenCalled();

    const raced = createFixture();
    raced.details.set('research-1', {
      ...defaultDetail,
      request: {
        ...request,
        scope: 'curated_and_public_web',
      },
    });
    raced.web.search.mockResolvedValueOnce({
      success: true,
      data: [webCitation],
    });
    raced.sources.set('web-1', {
      ...raced.sources.get('source-1')!,
      source: {
        id: 'web-1',
        kind: 'web',
        revision: 2,
        metadata: { canonicalUrl: 'https://example.test/vase' },
      },
    });
    raced.repositories.sources.addVersion.mockResolvedValueOnce(false);
    expect(await raced.handler(ownerId, 'job-1')).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT' },
    });
    expect(raced.model.draft).not.toHaveBeenCalled();
  });

  it('should fail and persist the provider error when model selection or retrieval fails', async () => {
    const unavailable = {
      code: 'SOURCE_UNAVAILABLE' as const,
      message: 'Provider unavailable',
      retryable: true,
    };
    const catalogFailure = createFixture();
    catalogFailure.catalog.resolve.mockResolvedValueOnce({
      success: false,
      error: unavailable,
    });
    expect(await catalogFailure.handler(ownerId, 'job-1')).toMatchObject({
      success: false,
      error: unavailable,
    });
    expect(catalogFailure.details.get('research-1')).toMatchObject({
      state: {
        kind: 'failed',
        error: { code: 'SOURCE_UNAVAILABLE', requestId: 'id-1' },
      },
    });
    expect(catalogFailure.text.snapshot).not.toHaveBeenCalled();

    const retrievalFailure = createFixture();
    retrievalFailure.text.snapshot.mockResolvedValueOnce({
      success: false,
      error: unavailable,
    });
    expect(await retrievalFailure.handler(ownerId, 'job-1')).toMatchObject({
      success: false,
      error: unavailable,
    });
    expect(retrievalFailure.model.draft).not.toHaveBeenCalled();
  });

  it('should return a lost job, lost detail, or revision race during failure persistence', async () => {
    const unavailable = {
      code: 'SOURCE_UNAVAILABLE' as const,
      message: 'Provider unavailable',
      retryable: true,
    };
    const missingJob = createFixture();
    missingJob.catalog.resolve.mockResolvedValueOnce({
      success: false,
      error: unavailable,
    });
    missingJob.repositories.jobs.get
      .mockResolvedValueOnce(missingJob.jobs.get('job-1')!)
      .mockResolvedValueOnce(null);
    expect(await missingJob.handler(ownerId, 'job-1')).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });

    const missingDetail = createFixture();
    missingDetail.catalog.resolve.mockResolvedValueOnce({
      success: false,
      error: unavailable,
    });
    missingDetail.repositories.research.get
      .mockResolvedValueOnce(defaultDetail)
      .mockResolvedValueOnce(null);
    expect(await missingDetail.handler(ownerId, 'job-1')).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });

    const raced = createFixture();
    raced.catalog.resolve.mockResolvedValueOnce({
      success: false,
      error: unavailable,
    });
    raced.repositories.jobs.update.mockResolvedValueOnce(false);
    expect(await raced.handler(ownerId, 'job-1')).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT' },
    });
  });

  it('should reject changed generated citations and unsupported draft paragraphs', async () => {
    const fixture = createFixture();
    fixture.model.draft.mockResolvedValueOnce({
      success: true,
      data: {
        value: {
          ...draft,
          citations: [{ ...pageCitation, relation: 'comparison' }],
        },
        invocation,
      },
    });
    expect(await fixture.handler(ownerId, 'job-1')).toMatchObject({
      success: false,
      error: { code: 'SOURCE_UNAVAILABLE' },
    });
    expect(fixture.details.get('research-1')).toMatchObject({
      state: { kind: 'failed' },
    });

    const missing = createFixture();
    missing.model.draft.mockResolvedValueOnce({
      success: true,
      data: {
        value: { ...draft, citations: [{ ...pageCitation, id: 'unknown' }] },
        invocation,
      },
    });
    expect(await missing.handler(ownerId, 'job-1')).toMatchObject({
      success: false,
      error: { code: 'SOURCE_UNAVAILABLE' },
    });

    const unsupported = createFixture();
    unsupported.model.draft.mockResolvedValueOnce({
      success: true,
      data: {
        value: {
          ...draft,
          paragraphs: [{ ...citedParagraph, citationIds: [] }],
        },
        invocation,
      },
    });
    expect(await unsupported.handler(ownerId, 'job-1')).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_FAILED' },
    });
  });

  it('should fail with the model error and stop before saving a draft', async () => {
    const fixture = createFixture();
    fixture.model.draft.mockResolvedValueOnce({
      success: false,
      error: {
        code: 'SOURCE_UNAVAILABLE',
        message: 'Model offline',
        retryable: true,
      },
      audit: { invocation: null, rawOutput: null },
    });
    expect(await fixture.handler(ownerId, 'job-1')).toMatchObject({
      success: false,
      error: { code: 'SOURCE_UNAVAILABLE' },
    });
    expect(fixture.details.get('research-1')).toMatchObject({
      state: { kind: 'failed' },
    });
  });

  it('should reject a missing or changed job during retrieval and final save', async () => {
    const missingAtFreeze = createFixture();
    missingAtFreeze.repositories.jobs.get
      .mockResolvedValueOnce(missingAtFreeze.jobs.get('job-1')!)
      .mockResolvedValueOnce(null);
    expect(await missingAtFreeze.handler(ownerId, 'job-1')).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });

    const changedAtFreeze = createFixture();
    changedAtFreeze.repositories.jobs.update.mockResolvedValueOnce(false);
    expect(await changedAtFreeze.handler(ownerId, 'job-1')).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT' },
    });
    expect(changedAtFreeze.model.draft).not.toHaveBeenCalled();

    const missingAtSave = createFixture();
    missingAtSave.repositories.research.get
      .mockResolvedValueOnce(defaultDetail)
      .mockResolvedValueOnce(null);
    expect(await missingAtSave.handler(ownerId, 'job-1')).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });

    const changedAtSave = createFixture();
    changedAtSave.repositories.jobs.update
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    expect(await changedAtSave.handler(ownerId, 'job-1')).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT' },
    });
  });
});
