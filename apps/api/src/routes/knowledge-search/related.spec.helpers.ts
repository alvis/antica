import { createHash, randomUUID } from 'node:crypto';

import { assert, expect } from 'vitest';

import { createKnowledgeService } from '@antica/application/server';
import { recordDetailSchema } from '@antica/contracts';

import type { RequestedAnalysisSnapshot } from '@antica/application/ports';
import type {
  KnowledgeContentEnvelopeV2,
  ModelInvocation,
  ProposedChange,
  RecordCreate,
  RecordDetail,
} from '@antica/contracts';
import type { Database } from '@antica/platform';

import type { HttpFixture } from '../../fixtures/http.js';

const createdStatus = 201;
const hashLength = 64;

/**
 * persists a record through the public write boundary
 * @param fixture authenticated HTTP fixture
 * @param fields explicit fields varied by a matching scenario
 * @returns persisted record revision
 */
export async function createRelatedRecord(
  fixture: HttpFixture,
  fields: Partial<RecordCreate>,
): Promise<RecordDetail> {
  const response = await fixture.request(
    '/v1/records',
    'POST',
    { unitKind: 'single', ...fields },
    randomUUID(),
  );
  expect(response.status).toBe(createdStatus);

  const created = recordDetailSchema.parse(await response.json());
  const persisted = await fixture.request(`/v1/records/${created.id}`);

  return recordDetailSchema.parse(await persisted.json());
}

/**
 * seeds a saved or draft revision using the production projection writer
 * @param fixture authenticated fixture and live database
 * @param content complete revision envelope
 * @param status saved visibility of the revision
 * @returns seeded entry identity
 */
export async function createRelatedEntry(
  fixture: HttpFixture,
  content: KnowledgeContentEnvelopeV2,
  status: 'saved' | 'draft' = 'saved',
): Promise<string> {
  const db = fixture.runtime.database.db;
  const { userId } = await db.session.findFirstOrThrow();
  const { transaction, clock, ids } = fixture.runtime;
  const result = await createKnowledgeService(transaction, clock, ids).createV2(
    userId,
    {
      requestKey: randomUUID(),
      expectedRevision: null,
      content,
      status,
      reviewDecisions: [],
      translationDecisions: [],
    },
  );
  assert(result.success, JSON.stringify(result));

  return result.data.id;
}

/** the development analysis model a seeded run names */
const analysisSelection = {
  role: 'analysis' as const,
  modelId: 'development:evidence-v1',
  profileVersion: '1',
};

/** how the seeded run's output was produced */
const analysisInvocation: ModelInvocation = {
  requestedModelId: analysisSelection.modelId,
  effectiveModelId: analysisSelection.modelId,
  provider: 'development',
  providerModelVersion: null,
  adapterKind: 'development',
  capabilities: {
    textInput: true,
    imageInput: true,
    audioInput: false,
    structuredOutput: true,
    toolCalling: false,
  },
  role: 'analysis',
  profileVersion: analysisSelection.profileVersion,
  promptVersion: 'analysis-prompt-v1',
  schemaVersion: 'analysis-output-v1',
  effectiveOptions: {},
  latencyMs: 1,
  usage: { inputTokens: null, outputTokens: null },
  finishReason: null,
  citationCheck: { valid: true, rejectedReferenceIds: [] },
};

/**
 * completes an analysis of the record whose suggestions wait undecided, making it the record's
 * latest run, through the production analysis repository
 * @param fixture authenticated fixture and live database
 * @param record record the analysis froze
 * @param proposedChanges the run's suggestions
 * @returns the run identity and the stored suggestion identities, which the run scopes, in order
 */
export async function completeSuggestions(
  fixture: HttpFixture,
  record: RecordDetail,
  proposedChanges: readonly ProposedChange[],
): Promise<{ readonly runId: string; readonly proposalIds: string[] }> {
  const db = fixture.runtime.database.db;
  const { userId } = await db.session.findFirstOrThrow();
  const now = new Date().toISOString();
  const runId = randomUUID();
  const jobId = randomUUID();
  const snapshot: RequestedAnalysisSnapshot = {
    id: randomUUID(),
    recordId: record.id,
    recordRevision: record.recordRevision,
    analysisInputVersion: record.analysisInputVersion,
    evidenceVersion: record.evidenceVersion,
    assetIds: [],
    evidenceIds: [],
    observationIds: [],
    checkIds: [],
    frozenPack: {
      recordFields: {
        name: record.name,
        unitKind: record.unitKind,
        components: record.components,
        pieceCount: record.pieceCount,
        categoryIds: record.categoryIds,
        materialIds: record.materialIds,
        period: record.period,
        dimensions: record.dimensions,
        location: record.location,
        acquisition: record.acquisition,
        tags: record.tags,
        description: record.description,
        collectorJudgment: record.collectorJudgment,
        condition: record.condition,
      },
      media: [],
      evidence: [],
      observations: [],
      checks: [],
    },
    createdAt: now,
  };
  const result = await fixture.runtime.transaction.run(userId, async (unit) => {
    await unit.jobs.create({
      id: jobId,
      kind: 'analysis',
      resourceId: runId,
      state: { kind: 'queued' },
      createdAt: now,
      updatedAt: now,
      result: null,
    });
    await unit.analyses.create({
      id: runId,
      jobId,
      recordId: record.id,
      requestedSnapshot: snapshot,
      modelSelection: analysisSelection,
      input: null,
      retrievalSnapshot: null,
      output: null,
      invocation: null,
      failureAudits: [],
      suggestedMethodVersions: [],
      status: 'queued',
    });
    await unit.analyses.saveOutput(
      runId,
      {
        summary: 'Seeded suggestions',
        findings: [],
        uncertainties: [],
        suggestedMethodIds: [],
        nextActions: [],
        proposedChanges: [...proposedChanges],
      },
      [],
      analysisInvocation,
      'completed',
    );
    const saved = await unit.analyses.get(runId);

    return {
      success: true as const,
      data: (saved?.output?.proposedChanges ?? []).map(({ id }) => id),
    };
  });
  assert(result.success, JSON.stringify(result));

  return { runId, proposalIds: result.data };
}

/**
 * records the collector skipping one suggestion, as the suggestions screen does
 * @param fixture authenticated fixture and live database
 * @param runId run that made the suggestion
 * @param proposalId skipped suggestion
 */
export async function skipSuggestion(
  fixture: HttpFixture,
  runId: string,
  proposalId: string,
): Promise<void> {
  const { userId } =
    await fixture.runtime.database.db.session.findFirstOrThrow();
  const result = await fixture.runtime.transaction.run(userId, async (unit) => {
    await unit.analyses.appendAdoption(
      runId,
      proposalId,
      'skipped',
      randomUUID(),
    );

    return { success: true as const, data: undefined };
  });
  assert(result.success, JSON.stringify(result));
}

/**
 * counts persistent rows and preserves record values to detect hidden writes
 * @param db live API database
 * @returns stable snapshot of all public tables and record content
 */
export async function snapshotRelatedRows(db: Database): Promise<unknown> {
  const tables = await db.$queryRaw<
    Array<{ tableName: string }>
  >`SELECT table_name AS "tableName" FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`;
  const counts = await Promise.all(
    tables.map(async ({ tableName: name }) => ({
      name,
      rows: await db.$queryRawUnsafe(
        `SELECT count(*)::text AS count FROM "${name.replaceAll('"', '""')}"`,
      ),
    })),
  );
  const records = await db.records.findMany({ orderBy: { id: 'asc' } });

  return { counts, records };
}

/**
 * varies title and topic membership while retaining unsupported discovery text
 * @param title original title for lexical matching
 * @param topicIds taxonomy memberships
 * @returns unsupported discovery envelope
 */
export function relatedContent(
  title: string,
  topicIds: string[] = [],
): KnowledgeContentEnvelopeV2 {
  return {
    contentSchemaVersion: 2,
    entryType: 'concept',
    origin: 'collector',
    titles: [{ language: 'en', text: title }],
    aliases: [],
    sections: {
      summary: {
        claimKey: 'body',
        text: 'Unreviewed observation',
        citationIds: [],
        supportState: 'needs_source',
      },
      history: [],
      features: [],
      applicability: [],
      limits: [],
    },
    claims: [
      {
        claimKey: 'body',
        section: 'summary',
        ordinal: 0,
        originalText: 'Unreviewed observation',
        originalLanguage: 'en',
        statementType: 'observation',
        scope: {},
        qualifiers: {},
        supportState: 'needs_source',
        citationIds: [],
        review: { state: 'pending' },
        variants: [],
      },
    ],
    topics: topicIds.map((topicId) => ({ topicId, applicability: 'general' })),
    citations: [],
    images: [],
    methodIds: [],
    relatedEntryIds: [],
    editorialReview: { state: 'pending' },
  };
}

/**
 * preserves one located web source and a reviewed bilingual claim
 * @param tx production connection
 * @param ownerId collector owning the evidence
 * @returns canonical envelope with immutable support metadata
 */
export async function citedEnvelope(
  tx: Database,
  ownerId: string,
): Promise<KnowledgeContentEnvelopeV2> {
  const sourceId = randomUUID();
  const versionId = randomUUID();
  const citationId = randomUUID();
  const instant = '2026-10-19T00:00:00.000Z';
  const originalText = 'Reviewed porcelain observation';
  const source = {
    id: sourceId,
    versionId,
    title: 'Catalog',
    canonicalUrl: 'https://museum.example/1',
    languages: ['en'],
    contributors: [],
  };
  const citation: KnowledgeContentEnvelopeV2['citations'][number] = {
    id: citationId,
    relation: 'supports',
    availability: 'link_only',
    verification: 'located',
    quote: originalText,
    locator: {
      kind: 'web',
      id: citationId,
      sourceId,
      sourceVersionId: versionId,
      url: source.canonicalUrl,
      retrievedAt: instant,
      excerpt: originalText,
    },
    source,
  };
  await persistSupport(tx, ownerId, citation);

  return reviewedContent(citation, ownerId);
}

/**
 * builds bilingual reviewed content around located evidence
 * @param citation immutable source citation
 * @param ownerId reviewer identity
 * @returns supported bilingual revision
 */
function reviewedContent(
  citation: KnowledgeContentEnvelopeV2['citations'][number],
  ownerId: string,
): KnowledgeContentEnvelopeV2 {
  const citationId = citation.id;
  const originalText = citation.quote;
  const instant = '2026-10-19T00:00:00.000Z';
  const base = relatedContent('Reviewed porcelain');
  const review = { state: 'reviewed' as const, actor: ownerId, at: instant };

  return {
    ...base,
    sections: {
      ...base.sections,
      summary: {
        claimKey: 'body',
        text: originalText,
        citationIds: [citationId],
        supportState: 'cited',
      },
    },
    claims: [
      {
        ...base.claims[0]!,
        originalText,
        supportState: 'cited',
        citationIds: [citationId],
        review,
        variants: [
          {
            language: 'zh-Hant',
            kind: 'translation',
            text: '已審核瓷器觀察',
            method: 'human',
            sourceTextHash: createHash('sha256')
              .update(originalText)
              .digest('hex'),
            review,
          },
        ],
      },
    ],
    citations: [citation],
    editorialReview: review,
  };
}

/**
 * persists immutable evidence for the API fixture
 * @param tx real database
 * @param ownerId evidence owner
 * @param citation located web citation
 */
async function persistSupport(
  tx: Database,
  ownerId: string,
  citation: KnowledgeContentEnvelopeV2['citations'][number],
): Promise<void> {
  const { source, id: citationId } = citation;
  const { id: sourceId, versionId } = source;
  const instant = '2026-10-19T00:00:00.000Z';
  const originalText = citation.quote;
  await tx.sources.create({
    data: {
      id: sourceId,
      ownerId,
      kind: 'web',
      title: source.title,
      authorStatus: 'unknown',
      access: 'link_only',
    },
  });
  await tx.sourceVersions.create({
    data: {
      id: versionId,
      sourceId,
      ownerId,
      sourceHash: 'a'.repeat(hashLength),
      metadataSnapshot: {
        title: source.title,
        canonicalUrl: source.canonicalUrl,
        languages: source.languages,
        contributors: [],
      },
      capturedAt: instant,
      status: 'registered',
      textIndexStatus: 'registered',
      imageIndexStatus: 'registered',
    },
  });
  await tx.sourceLocators.create({
    data: {
      id: citationId,
      sourceId,
      sourceVersionId: versionId,
      kind: 'web',
      url: source.canonicalUrl,
      retrievedAt: instant,
      excerptAsRetrieved: originalText,
    },
  });
  await tx.citations.create({
    data: {
      id: citationId,
      locatorId: citationId,
      relation: 'supports',
      availability: 'link_only',
      verification: 'located',
    },
  });
}
