import { z } from 'zod';

import {
  analysisInputSchema,
  entityIdSchema,
  recordFieldsSchema,
  retrievedMethodSchema,
  sourceCitationSchema,
} from '@antica/contracts';

import { readFile } from 'node:fs/promises';

import { maximumRelevanceGrade } from './metrics.js';

import type { AnalysisEvidencePack } from '@antica/application/ports';

/** validates the evaluation-only JSON envelope around the canonical evidence contract */
export const snapshotSchema = z
  .strictObject({
    provenance: z.string().min(1),
    input: analysisInputSchema,
    recordFields: recordFieldsSchema,
    text: z.array(
      z.union([
        z.strictObject({
          id: entityIdSchema,
          kind: z.enum(['observation', 'check']),
          content: z.string(),
        }),
        z.strictObject({
          kind: z.literal('source'),
          citationId: entityIdSchema,
          contentAsRetrieved: z.string(),
          sourceRegionId: entityIdSchema.nullable(),
        }),
      ]),
    ),
    images: z.array(
      z.strictObject({
        evidenceId: entityIdSchema,
        mediaType: z.string().startsWith('image/'),
        base64: z
          .string()
          .min(1)
          .regex(
            /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
          ),
      }),
    ),
    citations: z.array(sourceCitationSchema),
    methods: z.array(retrievedMethodSchema),
  })
  .superRefine((snapshot, context) => {
    const supplied = [
      {
        expected: snapshot.input.evidenceIds,
        actual: snapshot.images.map((image) => image.evidenceId),
      },
      {
        expected: snapshot.input.observationIds,
        actual: snapshot.text.flatMap((item) =>
          item.kind === 'observation' ? [item.id] : [],
        ),
      },
      {
        expected: snapshot.input.checkIds,
        actual: snapshot.text.flatMap((item) =>
          item.kind === 'check' ? [item.id] : [],
        ),
      },
    ];
    for (const group of supplied) {
      const actual = new Set(group.actual);
      if (
        actual.size !== group.actual.length ||
        new Set(group.expected).size !== group.expected.length ||
        group.expected.length !== actual.size ||
        group.expected.some((id) => !actual.has(id))
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'Snapshot IDs must match the supplied evidence, observations, and checks exactly',
        });
      }
    }
    const citationIds = new Set(
      snapshot.citations.map((citation) => citation.id),
    );
    if (
      citationIds.size !== snapshot.citations.length ||
      snapshot.text.some(
        (item) => item.kind === 'source' && !citationIds.has(item.citationId),
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Source excerpts must refer to unique supplied citations',
      });
    }
  });

/** captures JSON source data for exact replays */
export type EvaluationSnapshot = z.infer<typeof snapshotSchema>;

/** validates an authored corpus and independent graded query judgments */
export const corpusSchema = z
  .strictObject({
    version: entityIdSchema,
    documents: z
      .array(z.strictObject({ id: entityIdSchema, text: z.string().min(1) }))
      .min(1),
    queries: z
      .array(
        z.strictObject({
          id: z.string(),
          text: z.string(),
          relevance: z.record(
            z.string(),
            z.number().min(0).max(maximumRelevanceGrade),
          ),
        }),
      )
      .min(1),
  })
  .superRefine((corpus, context) => {
    const ids = new Set(corpus.documents.map((document) => document.id));
    if (ids.size !== corpus.documents.length) {
      context.addIssue({ code: 'custom', message: 'Duplicate document IDs' });
    }
    for (const query of corpus.queries) {
      if (Object.keys(query.relevance).some((id) => !ids.has(id))) {
        context.addIssue({
          code: 'custom',
          message: 'Judgment references an unknown document',
        });
      }
    }
  });

/** describes the fixed authored retrieval corpus */
export type RetrievalCorpus = z.infer<typeof corpusSchema>;

/**
 * reads an explicit file or a named committed synthetic snapshot
 * @param identifier fixture ID or JSON file path
 * @returns validated immutable comparison input
 */
export async function readSnapshot(
  identifier: string,
): Promise<EvaluationSnapshot> {
  const path = ['synthetic-evidence-v1', 'synthetic-no-evidence-v1'].includes(
    identifier,
  )
    ? new URL(`../fixtures/${identifier}.json`, import.meta.url)
    : identifier;

  return snapshotSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

/**
 * decodes fixture pixels into the shared model input without changing its content
 * @param snapshot validated JSON comparison input
 * @returns shared model evidence pack
 */
export function createEvidencePack(
  snapshot: EvaluationSnapshot,
): AnalysisEvidencePack {
  return {
    input: snapshot.input,
    recordFields: snapshot.recordFields,
    text: snapshot.text,
    citations: snapshot.citations,
    methods: snapshot.methods,
    images: snapshot.images.map(({ evidenceId, mediaType, base64 }) => ({
      evidenceId,
      mediaType,
      bytes: Buffer.from(base64, 'base64'),
    })),
  };
}

/**
 * loads and validates a fixed retrieval corpus
 * @param path optional external corpus file
 * @returns source documents and authored relevance judgments
 */
export async function readCorpus(path?: string): Promise<RetrievalCorpus> {
  return corpusSchema.parse(
    JSON.parse(
      await readFile(
        path ?? new URL('../fixtures/retrieval.json', import.meta.url),
        'utf8',
      ),
    ),
  );
}
