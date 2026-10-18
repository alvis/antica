import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import {
  entityIdSchema,
  recordFieldsSchema,
  recordVersionsSchema,
} from '@antica/contracts';

/** names the editing behaviours each case exercises */
export const editingCaseKindSchema = z.enum([
  'ask',
  'edit',
  'mixed',
  'correction',
  'injection',
  'restricted',
]);

/** describes one editing behaviour exercised by a case */
export type EditingCaseKind = z.infer<typeof editingCaseKindSchema>;

/** lists the schema-allowlisted fields a case may expect a proposal for */
export const editingFieldSchema = z.enum([
  'name',
  'description',
  'materialIds',
  'period',
  'tags',
  'collectorJudgment',
]);

const kindsWithoutRequiredProposals: readonly EditingCaseKind[] = [
  'ask',
  'injection',
  'restricted',
];

/** validates synthetic records and collector messages with expected proposal fields */
export const editingDatasetSchema = z
  .strictObject({
    version: z.string().min(1),
    provenance: z.string().min(1),
    records: z
      .array(
        z.strictObject({
          key: z.string().min(1),
          recordId: entityIdSchema,
          versions: recordVersionsSchema,
          fields: recordFieldsSchema,
        }),
      )
      .min(1),
    cases: z
      .array(
        z.strictObject({
          id: z.string().min(1),
          kind: editingCaseKindSchema,
          record: z.string().min(1),
          requestKey: entityIdSchema,
          messageZhHant: z.string().trim().min(1),
          expectedFields: z.array(editingFieldSchema),
          permittedFields: z.array(editingFieldSchema),
          notes: z.string(),
        }),
      )
      .min(1),
  })
  .superRefine((dataset, context) => {
    const keys = new Set(dataset.records.map((record) => record.key));
    const isUnique = (values: readonly string[]): boolean =>
      new Set(values).size === values.length;
    if (
      !isUnique(dataset.records.map((record) => record.key)) ||
      !isUnique(dataset.records.map((record) => record.recordId)) ||
      !isUnique(dataset.cases.map((item) => item.id)) ||
      !isUnique(dataset.cases.map((item) => item.requestKey))
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Record keys, record IDs, case IDs and request keys must be unique',
      });
    }
    for (const item of dataset.cases) {
      if (
        !keys.has(item.record) ||
        !isUnique([...item.expectedFields, ...item.permittedFields]) ||
        (kindsWithoutRequiredProposals.includes(item.kind) &&
          item.expectedFields.length > 0) ||
        (!kindsWithoutRequiredProposals.includes(item.kind) &&
          item.expectedFields.length === 0)
      ) {
        context.addIssue({
          code: 'custom',
          message: `Case ${item.id} must use a known record, disjoint fields, and proposals that match its kind`,
        });
      }
    }
  });

/** captures the fixed editing dataset used for replayable comparisons */
export type EditingDataset = z.infer<typeof editingDatasetSchema>;

/** describes one synthetic record the editing cases refer to */
export type EditingRecord = EditingDataset['records'][number];

/** describes one collector message and its expected proposal fields */
export type EditingCase = EditingDataset['cases'][number];

/**
 * reads an explicit file or the named committed synthetic editing dataset
 * @param identifier fixture ID or JSON file path
 * @returns validated editing dataset
 */
export async function readEditingDataset(
  identifier: string,
): Promise<EditingDataset> {
  const path = ['editing-v1'].includes(identifier)
    ? new URL(`../fixtures/${identifier}.json`, import.meta.url)
    : identifier;

  return editingDatasetSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}
