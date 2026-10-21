import { recordFieldsSchema } from '@antica/contracts';

import { createRecordRepository } from '../repositories/records.js';

import type {
  ModelInvocation,
  ModelRole,
  ModelSelection,
  RecordDetail,
  RecordFields,
} from '@antica/contracts';

import type { Database } from '../connection.js';
import type { Transaction } from '../transaction.js';

import type { SavedCorpus } from './knowledge.js';

/** database, owner and saved knowledge every seeded result is written with */
export interface DemoRunContext {
  readonly db: Database;
  readonly ownerId: string;
  readonly corpus: SavedCorpus;
  /** knowledge entry id per vocabulary title */
  readonly vocabulary: ReadonlyMap<string, string>;
}

/** one minute, the spacing of seeded timestamps */
export const minuteMs = 60_000;

/** long enough for the seed's multi-statement transactions */
export const transactionTimeoutMs = 60_000;

// marks every seeded result as authored by the demo seed rather than a model
const seedModelId = 'antica-demo-seed';
const seedProfileVersion = 'demo-seed-1';

/**
 * names the seed as the model behind a role's results
 * @param role model role of the result
 * @returns model selection stored with the run
 */
export function seedModelSelection(role: ModelRole): ModelSelection {
  return { role, modelId: seedModelId, profileVersion: seedProfileVersion };
}

/**
 * audit record stating that the seed, not a provider, authored the result
 * @param role model role of the result
 * @returns invocation stored with the result
 */
export function seedInvocation(role: ModelRole): ModelInvocation {
  return {
    requestedModelId: seedModelId,
    effectiveModelId: seedModelId,
    provider: seedModelId,
    providerModelVersion: null,
    adapterKind: 'development',
    capabilities: {
      textInput: true,
      imageInput: true,
      audioInput: false,
      structuredOutput: true,
      toolCalling: false,
    },
    role,
    profileVersion: seedProfileVersion,
    promptVersion:
      role === 'analysis' ? 'analysis-prompt-v1' : seedProfileVersion,
    schemaVersion:
      role === 'analysis' ? 'analysis-output-v1' : seedProfileVersion,
    effectiveOptions: {},
    latencyMs: 0,
    usage: { inputTokens: null, outputTokens: null },
    finishReason: 'stop',
    citationCheck: { valid: true, rejectedReferenceIds: [] },
  };
}

/**
 * describes the retrieval index a seeded snapshot claims to come from
 * @returns index identity naming the seed
 */
export function seedIndexIdentity(): {
  readonly embeddingModelId: string;
  readonly dimensions: number;
  readonly indexVersion: string;
} {
  return {
    embeddingModelId: seedModelId,
    dimensions: 1,
    indexVersion: seedProfileVersion,
  };
}

/**
 * reads the record a result is written for
 * @param tx transaction of the write
 * @param ownerId demo owner
 * @param recordId record to read
 * @returns the record detail
 */
export async function readRecord(
  tx: Transaction,
  ownerId: string,
  recordId: string,
): Promise<RecordDetail> {
  const record = await createRecordRepository(tx, ownerId).get(recordId);
  if (!record) {
    throw new Error(`Record missing: ${recordId}`);
  }

  return record;
}

/**
 * projects the editable fields of a record, as the analysis service freezes them
 * @param record record detail
 * @returns contract fields without lifecycle metadata
 */
export function recordFieldsOf(record: RecordDetail): RecordFields {
  return recordFieldsSchema.parse({
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
  });
}

/**
 * moves an instant by a number of milliseconds
 * @param instant ISO instant with any offset
 * @param shiftMs milliseconds to add, negative to go back
 * @returns the shifted instant in UTC
 */
export function shiftInstant(instant: string, shiftMs: number): string {
  return new Date(Date.parse(instant) + shiftMs).toISOString();
}
