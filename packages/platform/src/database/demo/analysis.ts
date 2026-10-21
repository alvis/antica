import { randomUUID } from 'node:crypto';

import { createAnalysisRepository } from '../repositories/analysis.js';
import { createEvidenceRepository } from '../repositories/evidence.js';
import { createMediaRepository } from '../repositories/media.js';
import { createJobRepository } from '../repositories/runtime.js';

import {
  findCorpusCitation,
  resolveSavedClaim,
  toWebCitation,
  vocabularyEntryId,
} from './knowledge.js';
import {
  minuteMs,
  readRecord,
  recordFieldsOf,
  seedIndexIdentity,
  seedInvocation,
  seedModelSelection,
  shiftInstant,
  transactionTimeoutMs,
} from './provenance.js';

import type {
  AnalysisOutput,
  MediaAsset,
  ProposedChange,
  RecordDetail,
} from '@antica/contracts';
import type { EvidenceAnchor } from '@antica/domain';

import type { Transaction } from '../transaction.js';

import type { DemoAnalysis, DemoProposal } from './fixtures/analyses.js';
import type { DemoRunContext } from './provenance.js';

/** seeded analysis of one record */
export interface DemoAnalysisParams {
  readonly context: DemoRunContext;
  readonly analysis: DemoAnalysis;
  readonly recordId: string;
  /** whole-image evidence anchor id per photo angle label */
  readonly evidenceByAngle: ReadonlyMap<string, string>;
}

/** a proposed change without the ids the run assigns, kept per field */
type ProposedValues<Change = ProposedChange> = Change extends ProposedChange
  ? Omit<Change, 'id' | 'findingIds'>
  : never;

/** what the run freezes: the record, its ready object photos and their anchors */
interface FrozenInput {
  readonly record: RecordDetail;
  readonly media: readonly MediaAsset[];
  readonly evidence: readonly EvidenceAnchor[];
}

/** ids generated for one run */
interface RunIdentity {
  readonly runId: string;
  readonly jobId: string;
  readonly snapshotId: string;
  readonly retrievalSnapshotId: string;
  readonly createdAt: string;
  readonly completedAt: string;
}

/**
 * writes a completed analysis run through the analysis repository; its job is terminal and never queued
 * @param params owner context, the analysis to write, its record and evidence anchors
 * @returns the run id
 */
export async function insertAnalysisRun(
  params: DemoAnalysisParams,
): Promise<string> {
  const { context, analysis, recordId } = params;
  const completedAt = new Date(analysis.completedAt).toISOString();
  const identity: RunIdentity = {
    runId: randomUUID(),
    jobId: randomUUID(),
    snapshotId: randomUUID(),
    retrievalSnapshotId: randomUUID(),
    createdAt: shiftInstant(completedAt, -minuteMs),
    completedAt,
  };
  await context.db.$transaction(
    async (tx) => {
      const input = await readFrozenInput(tx, context.ownerId, recordId);
      await createJobRepository(tx, context.ownerId).create({
        id: identity.jobId,
        kind: 'analysis',
        resourceId: identity.runId,
        state: { kind: 'succeeded', completedAt },
        createdAt: identity.createdAt,
        updatedAt: completedAt,
        result: { runId: identity.runId },
      });
      const analyses = createAnalysisRepository(tx, context.ownerId);
      await createRun(analyses, identity, input);
      await bindRetrieval(analyses, identity, { input, params });
      await analyses.saveOutput(
        identity.runId,
        analysisOutput(params, input.record),
        [],
        seedInvocation('analysis'),
        analysis.status,
      );
    },
    { timeout: transactionTimeoutMs },
  );

  return identity.runId;
}

/**
 * reads the record, its ready object photos and their evidence anchors
 * @param tx transaction of the run
 * @param ownerId demo owner
 * @param recordId record whose analysis input is frozen
 * @returns the record, its ready photos and their anchors
 */
async function readFrozenInput(
  tx: Transaction,
  ownerId: string,
  recordId: string,
): Promise<FrozenInput> {
  const record = await readRecord(tx, ownerId, recordId);
  const repository = createMediaRepository(tx, ownerId);
  const assets = await Promise.all(
    record.mediaIds.map(async (id) => repository.get(id)),
  );
  const media = assets.filter(
    (asset): asset is MediaAsset =>
      asset?.state === 'ready' && asset.purpose === 'object',
  );
  const anchors = createEvidenceRepository(tx, ownerId);
  const evidence = await Promise.all(
    media.map(async (asset) => anchors.queryAnchorsByAsset(asset.id)),
  );

  return { record, media, evidence: evidence.flat() };
}

/**
 * creates the run on its frozen snapshot, as an analysis request does
 * @param analyses analysis repository of the transaction
 * @param identity ids of the run
 * @param input frozen record, photos and anchors
 */
async function createRun(
  analyses: ReturnType<typeof createAnalysisRepository>,
  identity: RunIdentity,
  input: FrozenInput,
): Promise<void> {
  const { record, media, evidence } = input;
  await analyses.create({
    id: identity.runId,
    jobId: identity.jobId,
    recordId: record.id,
    requestedSnapshot: {
      id: identity.snapshotId,
      recordId: record.id,
      recordRevision: record.recordRevision,
      analysisInputVersion: record.analysisInputVersion,
      evidenceVersion: record.evidenceVersion,
      assetIds: media.map((asset) => asset.id),
      evidenceIds: evidence.map((anchor) => anchor.id),
      observationIds: [],
      checkIds: [],
      frozenPack: {
        recordFields: recordFieldsOf(record),
        media: [...media],
        evidence: [...evidence],
        observations: [],
        checks: [],
      },
      createdAt: identity.createdAt,
    },
    input: null,
    retrievalSnapshot: null,
    output: null,
    invocation: null,
    failureAudits: [],
    suggestedMethodVersions: [],
    modelSelection: seedModelSelection('analysis'),
    status: 'queued',
  });
}

/**
 * binds the analysis input and a retrieval snapshot holding the cited corpus sources
 * @param analyses analysis repository of the transaction
 * @param identity ids of the run
 * @param sources frozen input and the seeded analysis
 * @param sources.input frozen record, photos and anchors
 * @param sources.params seeded analysis with its saved corpus
 */
async function bindRetrieval(
  analyses: ReturnType<typeof createAnalysisRepository>,
  identity: RunIdentity,
  sources: { readonly input: FrozenInput; readonly params: DemoAnalysisParams },
): Promise<void> {
  const { record, media, evidence } = sources.input;
  const { corpus } = sources.params.context;
  const citations = citedIds(sources.params).map((id) =>
    findCorpusCitation(corpus, id),
  );
  await analyses.bindRetrievalSnapshot(
    identity.runId,
    {
      recordId: record.id,
      snapshotId: identity.snapshotId,
      recordRevision: record.recordRevision,
      analysisInputVersion: record.analysisInputVersion,
      evidenceVersion: record.evidenceVersion,
      assetIds: media.map((asset) => asset.id),
      evidenceIds: evidence.map((anchor) => anchor.id),
      observationIds: [],
      checkIds: [],
      retrievalSnapshotId: identity.retrievalSnapshotId,
      promptVersion: 'analysis-prompt-v1',
      schemaVersion: 'analysis-output-v1',
    },
    {
      id: identity.retrievalSnapshotId,
      index: seedIndexIdentity(),
      citations: citations.map(toWebCitation),
      text: citations.map((citation) => ({
        citationId: citation.id,
        contentAsRetrieved: citation.quote,
        sourceRegionId: null,
      })),
      methods: [],
      createdAt: identity.createdAt,
    },
  );
}

/**
 * builds the analysis output, resolving proposal values against the current record
 * @param params seeded analysis, its evidence anchors and saved knowledge
 * @param record record as it stands when the run completes
 * @returns contract output with generated ids the repository scopes to the run
 */
function analysisOutput(
  params: DemoAnalysisParams,
  record: RecordDetail,
): AnalysisOutput {
  const { analysis, evidenceByAngle, context } = params;
  const findingIds = new Map(
    analysis.findings.map((finding) => [finding.key, randomUUID()]),
  );

  return {
    summary: analysis.summary,
    findings: analysis.findings.map((finding) => ({
      id: findingIds.get(finding.key)!,
      kind: finding.kind,
      text: finding.text,
      evidenceIds: finding.evidenceAngles.map((label) =>
        anchorOf(evidenceByAngle, label),
      ),
      observationIds: [],
      citationIds: [
        ...new Set(
          finding.citations.flatMap(
            (reference) =>
              resolveSavedClaim(context.corpus, reference).citationIds,
          ),
        ),
      ],
      relation: finding.relation,
      certainty: finding.certainty,
    })),
    uncertainties: [...analysis.uncertainties],
    suggestedMethodIds: [],
    nextActions: analysis.nextActions.map((action) => ({
      id: randomUUID(),
      kind: action.kind,
      instruction: action.instruction,
      reason: action.reason,
    })),
    proposedChanges: analysis.proposals.map((proposal) => ({
      ...proposedValues(proposal, record, context.vocabulary),
      confidence: proposal.confidence,
      id: randomUUID(),
      findingIds: proposal.findingKeys.map((key) => findingIds.get(key)!),
    })),
  };
}

/**
 * resolves one seeded proposal into the contract's field, before and proposed values
 * @param proposal seeded proposal
 * @param record record the proposal is made against
 * @param vocabulary knowledge entry id per vocabulary title
 * @returns field change values whose `before` matches the record unless the proposal is stale
 */
function proposedValues(
  proposal: DemoProposal,
  record: RecordDetail,
  vocabulary: ReadonlyMap<string, string>,
): ProposedValues {
  switch (proposal.field) {
    case 'categoryIds':
    case 'materialIds':
      return {
        field: proposal.field,
        before: record[proposal.field],
        proposed: proposal.proposedTerms.map((term) =>
          vocabularyEntryId(vocabulary, term),
        ),
      };
    case 'period':
      return {
        field: 'period',
        before: record.period,
        proposed: proposal.proposed,
      };
    case 'surface':
      return {
        field: 'surface',
        before: record.surface ?? null,
        proposed: proposal.proposed,
      };
    case 'description':
      return {
        field: 'description',
        before: record.description,
        proposed: `${record.description}${proposal.appendedText}`,
      };
    case 'dimensions':
      return {
        field: 'dimensions',
        before: proposal.staleBefore,
        proposed: proposal.proposed,
      };
    default:
      return {
        field: 'name',
        before: proposal.staleBefore,
        proposed: proposal.proposed,
      };
  }
}

/**
 * lists the corpus citation ids the analysis findings cite
 * @param params seeded analysis with its saved corpus
 * @returns distinct citation ids in finding order
 */
function citedIds(params: DemoAnalysisParams): readonly string[] {
  return [
    ...new Set(
      params.analysis.findings
        .flatMap((finding) => finding.citations)
        .flatMap(
          (reference) =>
            resolveSavedClaim(params.context.corpus, reference).citationIds,
        ),
    ),
  ];
}

/**
 * looks up the evidence anchor of a photo angle
 * @param evidenceByAngle anchor id per photo angle label
 * @param label photo angle label
 * @returns the anchor id
 */
function anchorOf(
  evidenceByAngle: ReadonlyMap<string, string>,
  label: string,
): string {
  const anchorId = evidenceByAngle.get(label);
  if (!anchorId) {
    throw new Error(`No evidence anchor for the ${label} photo`);
  }

  return anchorId;
}
