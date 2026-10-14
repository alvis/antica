import { createHash } from 'node:crypto';

import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from 'drizzle-orm';

import { ComponentInUseError } from '@antica/application/ports';
import { calculateAnalysisFreshness } from '@antica/domain';

import {
  analysisRuns,
  analysisSnapshots,
  locations,
  mediaAssets,
  mediaDerivatives,
  recordAcquisitions,
  recordCategories,
  recordChecks,
  recordComponents,
  recordMaterials,
  recordMeasurements,
  recordReceipts,
  records,
  recordTags,
} from '../schema/index.js';

import type {
  RecordRepository,
  LocationRepository,
} from '@antica/application/ports';
import type {
  CollectionQuery,
  RecordDetail,
  RecordPatch,
  RecordSummary,
} from '@antica/contracts';
import type { RecordVersions } from '@antica/domain';

import type { Transaction } from '../transaction.js';

type Cursor = {
  readonly signature: string;
  readonly sort: 'updated' | 'code' | 'name';
  readonly value: string | null;
  readonly id: string;
};

function querySignature(query: CollectionQuery): string {
  const { cursor: _cursor, limit: _limit, ...filters } = query;

  return createHash('sha256').update(JSON.stringify(filters)).digest('hex');
}

function decodeCursor(
  value: string,
  signature: string,
  sort: Cursor['sort'],
): Cursor {
  const cursor = JSON.parse(
    Buffer.from(value, 'base64url').toString('utf8'),
  ) as Cursor;
  if (
    cursor.signature !== signature ||
    cursor.sort !== sort ||
    typeof cursor.id !== 'string'
  ) {
    throw new Error('Cursor does not match query');
  }

  return cursor;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/**
 * binds all collection operations to one collector and one transaction
 * @param tx
 * @param ownerId
 */
export function createRecordRepository(
  tx: Transaction,
  ownerId: string,
): RecordRepository {
  async function readLatestRunInputVersions(
    runIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>> {
    if (runIds.length === 0) {
      return new Map();
    }
    const rows = await tx
      .select({
        runId: analysisRuns.id,
        analysisInputVersion: analysisSnapshots.analysisInputVersion,
      })
      .from(analysisRuns)
      .innerJoin(
        analysisSnapshots,
        eq(analysisRuns.snapshotId, analysisSnapshots.id),
      )
      .where(
        and(
          eq(analysisRuns.ownerId, ownerId),
          inArray(analysisRuns.id, runIds),
          inArray(analysisRuns.status, ['completed', 'partial']),
        ),
      );

    return new Map(
      rows.map((row) => [row.runId, row.analysisInputVersion] as const),
    );
  }

  async function get(id: string): Promise<RecordDetail | null> {
    const [row] = await tx
      .select()
      .from(records)
      .where(and(eq(records.id, id), eq(records.ownerId, ownerId)));
    if (!row) {
      return null;
    }
    const [
      components,
      categories,
      materials,
      tags,
      measurements,
      acquisitions,
      receipts,
      media,
      checks,
      latestRunInputVersions,
    ] = await Promise.all([
      tx
        .select()
        .from(recordComponents)
        .where(eq(recordComponents.recordId, id))
        .orderBy(asc(recordComponents.ordinal)),
      tx
        .select()
        .from(recordCategories)
        .where(eq(recordCategories.recordId, id)),
      tx.select().from(recordMaterials).where(eq(recordMaterials.recordId, id)),
      tx.select().from(recordTags).where(eq(recordTags.recordId, id)),
      tx
        .select()
        .from(recordMeasurements)
        .where(eq(recordMeasurements.recordId, id)),
      tx
        .select()
        .from(recordAcquisitions)
        .where(eq(recordAcquisitions.recordId, id)),
      tx
        .select({ id: recordReceipts.assetId })
        .from(recordReceipts)
        .where(eq(recordReceipts.recordId, id)),
      tx
        .select({ id: mediaAssets.id })
        .from(mediaAssets)
        .where(
          and(eq(mediaAssets.recordId, id), eq(mediaAssets.ownerId, ownerId)),
        ),
      tx
        .select({ id: recordChecks.id })
        .from(recordChecks)
        .where(
          and(eq(recordChecks.recordId, id), eq(recordChecks.ownerId, ownerId)),
        ),
      readLatestRunInputVersions(row.latestRunId ? [row.latestRunId] : []),
    ]);
    const acquisition = acquisitions[0];
    const dimension = (kind: string): RecordDetail['dimensions']['height'] => {
      const value = measurements.find((item) => item.kind === kind);
      if (!value) {
        return undefined;
      }

      return {
        value: Number(value.value),
        unit: value.unit as 'mm' | 'cm' | 'm',
        componentId: value.componentId ?? undefined,
      };
    };
    const weightValue = measurements.find((item) => item.kind === 'weight');
    const detail: RecordDetail = {
      id: row.id,
      code: row.code,
      name: row.name,
      unitKind: row.unitKind as 'single' | 'set',
      components: components.map((item) => ({
        id: item.id,
        label: item.label,
      })),
      pieceCount: row.pieceCount,
      categoryIds: categories.map((item) => item.categoryId),
      materialIds: materials.map((item) => item.materialId),
      period: row.periodStatus
        ? {
            label: row.periodLabel ?? '',
            fromYear: row.periodFromYear ?? undefined,
            toYear: row.periodToYear ?? undefined,
            status: row.periodStatus as 'collectorClaim' | 'unconfirmed',
          }
        : null,
      dimensions: {
        height: dimension('height'),
        width: dimension('width'),
        depth: dimension('depth'),
        diameter: dimension('diameter'),
        weight: weightValue
          ? {
              value: Number(weightValue.value),
              unit: weightValue.unit as 'g' | 'kg',
              componentId: weightValue.componentId ?? undefined,
            }
          : undefined,
      },
      location: { locationId: row.locationId, detail: row.locationDetail },
      acquisition: {
        acquiredOn: acquisition?.acquiredOn ?? undefined,
        seller: acquisition?.seller ?? undefined,
        method: acquisition?.method ?? undefined,
        amount: acquisition?.amount ?? undefined,
        currency: acquisition?.currency ?? undefined,
        receiptAssetIds: receipts.map((item) => item.id),
        provenanceNote: acquisition?.provenanceNote ?? undefined,
      },
      tags: tags.map((item) => item.tag),
      description: row.description,
      collectorJudgment: row.collectorJudgment,
      recordRevision: row.recordRevision,
      analysisInputVersion: row.analysisInputVersion,
      evidenceVersion: row.evidenceVersion,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      mediaIds: media.map((item) => item.id),
      checkIds: checks.map((item) => item.id),
      latestRunId: row.latestRunId,
      analysisFreshness: calculateAnalysisFreshness(
        row.latestRunId
          ? (latestRunInputVersions.get(row.latestRunId) ?? null)
          : null,
        row.analysisInputVersion,
      ),
    };

    return detail;
  }

  async function allocateCode(): Promise<string> {
    const result = await tx.execute(sql`
      insert into sequence_counters (owner_id, kind, next_value) values (${ownerId}, 'record', 2)
      on conflict (owner_id, kind) do update set next_value = sequence_counters.next_value + 1
      returning next_value - 1 as value
    `);

    return `AC-${String(result[0]?.value).padStart(6, '0')}`;
  }

  async function saveRelations(
    id: string,
    fields: Partial<RecordDetail>,
  ): Promise<void> {
    let removedComponentIds: string[] = [];
    if (fields.components) {
      const existing = await tx
        .select({ id: recordComponents.id })
        .from(recordComponents)
        .where(eq(recordComponents.recordId, id));
      const existingIds = new Set(existing.map((item) => item.id));
      const requestedIds = new Set(fields.components.map((item) => item.id));
      removedComponentIds = existing
        .filter((item) => !requestedIds.has(item.id))
        .map((item) => item.id);
      if (existing.length) {
        await tx
          .update(recordComponents)
          .set({ ordinal: sql`-${recordComponents.ordinal} - 1` })
          .where(eq(recordComponents.recordId, id));
      }
      for (const [ordinal, item] of fields.components.entries()) {
        if (existingIds.has(item.id)) {
          await tx
            .update(recordComponents)
            .set({ label: item.label, ordinal })
            .where(
              and(
                eq(recordComponents.id, item.id),
                eq(recordComponents.recordId, id),
              ),
            );
        } else {
          await tx
            .insert(recordComponents)
            .values({ ...item, recordId: id, ownerId, ordinal });
        }
      }
    }
    if (fields.categoryIds) {
      await tx
        .delete(recordCategories)
        .where(eq(recordCategories.recordId, id));
      if (fields.categoryIds.length) {
        await tx.insert(recordCategories).values(
          fields.categoryIds.map((categoryId) => ({
            recordId: id,
            categoryId,
          })),
        );
      }
    }
    if (fields.materialIds) {
      await tx.delete(recordMaterials).where(eq(recordMaterials.recordId, id));
      if (fields.materialIds.length) {
        await tx.insert(recordMaterials).values(
          fields.materialIds.map((materialId) => ({
            recordId: id,
            materialId,
          })),
        );
      }
    }
    if (fields.tags) {
      await tx.delete(recordTags).where(eq(recordTags.recordId, id));
      if (fields.tags.length) {
        await tx
          .insert(recordTags)
          .values(fields.tags.map((tag) => ({ recordId: id, tag })));
      }
    }
    if (fields.dimensions) {
      for (const kind of [
        'height',
        'width',
        'depth',
        'diameter',
        'weight',
      ] as const) {
        if (!(kind in fields.dimensions)) {
          continue;
        }
        const value = fields.dimensions[kind];
        await tx
          .delete(recordMeasurements)
          .where(
            and(
              eq(recordMeasurements.recordId, id),
              eq(recordMeasurements.kind, kind),
            ),
          );
        if (value) {
          await tx.insert(recordMeasurements).values({
            recordId: id,
            kind,
            value: String(value.value),
            unit: value.unit,
            componentId: value.componentId ?? null,
          });
        }
      }
    }
    if (fields.acquisition) {
      const value = fields.acquisition;
      const acquisition = {
        acquiredOn: value.acquiredOn ?? null,
        seller: value.seller ?? null,
        method: value.method ?? null,
        amount: value.amount ?? null,
        currency: value.currency ?? null,
        provenanceNote: value.provenanceNote ?? null,
      };
      await tx
        .insert(recordAcquisitions)
        .values({ recordId: id, ...acquisition })
        .onConflictDoUpdate({
          target: recordAcquisitions.recordId,
          set: acquisition,
        });
      await tx.delete(recordReceipts).where(eq(recordReceipts.recordId, id));
      if (value.receiptAssetIds.length) {
        await tx
          .insert(recordReceipts)
          .values(
            value.receiptAssetIds.map((assetId) => ({ recordId: id, assetId })),
          );
      }
    }
    for (const componentId of removedComponentIds) {
      try {
        await tx
          .delete(recordComponents)
          .where(
            and(
              eq(recordComponents.id, componentId),
              eq(recordComponents.recordId, id),
            ),
          );
      } catch (error) {
        const cause = error as { cause?: { code?: string }; code?: string };
        if (cause.code === '23503' || cause.cause?.code === '23503') {
          throw new ComponentInUseError();
        }
        throw error;
      }
    }
  }

  return {
    allocateCode,
    get,
    async getThumbnailTargets(recordIds) {
      if (recordIds.length === 0) {
        return [];
      }
      const rows = await tx
        .selectDistinctOn([mediaAssets.recordId], {
          recordId: records.id,
          assetOrDerivativeId: mediaDerivatives.id,
          storageKey: mediaDerivatives.objectKey,
        })
        .from(mediaAssets)
        .innerJoin(
          records,
          and(
            eq(records.id, mediaAssets.recordId),
            eq(records.ownerId, ownerId),
          ),
        )
        .innerJoin(
          mediaDerivatives,
          and(
            eq(mediaDerivatives.originalAssetId, mediaAssets.id),
            eq(mediaDerivatives.ownerId, ownerId),
            eq(mediaDerivatives.kind, 'thumbnail'),
          ),
        )
        .where(
          and(
            eq(mediaAssets.ownerId, ownerId),
            inArray(mediaAssets.recordId, [...recordIds]),
            eq(mediaAssets.kind, 'photo'),
            eq(mediaAssets.purpose, 'object'),
            eq(mediaAssets.state, 'ready'),
          ),
        )
        .orderBy(
          asc(mediaAssets.recordId),
          asc(mediaAssets.createdAt),
          asc(mediaAssets.id),
          asc(mediaDerivatives.id),
        );
      return rows;
    },
    async create(record): Promise<void> {
      await tx.insert(records).values({
        id: record.id,
        ownerId,
        code: record.code,
        name: record.name,
        unitKind: record.unitKind,
        pieceCount: record.pieceCount,
        periodLabel: record.period?.label,
        periodFromYear: record.period?.fromYear,
        periodToYear: record.period?.toYear,
        periodStatus: record.period?.status,
        locationId: record.location.locationId,
        locationDetail: record.location.detail,
        description: record.description,
        collectorJudgment: record.collectorJudgment,
        recordRevision: record.recordRevision,
        analysisInputVersion: record.analysisInputVersion,
        evidenceVersion: record.evidenceVersion,
        latestRunId: record.latestRunId,
      });
      await saveRelations(record.id, record);
    },
    async patch(
      id: string,
      patch: RecordPatch,
      versions: RecordVersions,
    ): Promise<RecordDetail | null> {
      const fields = patch.fields;
      const changed = await tx
        .update(records)
        .set({
          name: fields.name,
          unitKind: fields.unitKind,
          pieceCount: fields.pieceCount,
          periodLabel:
            fields.period === undefined
              ? undefined
              : (fields.period?.label ?? null),
          periodFromYear:
            fields.period === undefined
              ? undefined
              : (fields.period?.fromYear ?? null),
          periodToYear:
            fields.period === undefined
              ? undefined
              : (fields.period?.toYear ?? null),
          periodStatus:
            fields.period === undefined
              ? undefined
              : (fields.period?.status ?? null),
          locationId: fields.location?.locationId,
          locationDetail: fields.location?.detail,
          description: fields.description,
          collectorJudgment: fields.collectorJudgment,
          recordRevision: versions.recordRevision,
          analysisInputVersion: versions.analysisInputVersion,
          evidenceVersion: versions.evidenceVersion,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(records.id, id),
            eq(records.ownerId, ownerId),
            eq(records.recordRevision, patch.expectedRevision),
          ),
        )
        .returning({ id: records.id });
      if (!changed.length) {
        return null;
      }
      await saveRelations(id, fields);

      return get(id);
    },
    async bumpVersions(
      id: string,
      expectedRevision: number,
      changes: { readonly analysisInput: boolean; readonly evidence: boolean },
    ): Promise<RecordVersions | null> {
      const [row] = await tx
        .update(records)
        .set({
          recordRevision: sql`${records.recordRevision} + 1`,
          analysisInputVersion: changes.analysisInput
            ? sql`${records.analysisInputVersion} + 1`
            : records.analysisInputVersion,
          evidenceVersion: changes.evidence
            ? sql`${records.evidenceVersion} + 1`
            : records.evidenceVersion,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(records.id, id),
            eq(records.ownerId, ownerId),
            eq(records.recordRevision, expectedRevision),
          ),
        )
        .returning({
          recordRevision: records.recordRevision,
          analysisInputVersion: records.analysisInputVersion,
          evidenceVersion: records.evidenceVersion,
        });

      return row ?? null;
    },
    async query(
      query: CollectionQuery,
    ): Promise<{ items: RecordSummary[]; nextCursor: string | null }> {
      const limit = Math.min(query.limit ?? 50, 100);
      const sort = query.sort ?? 'updated';
      const signature = querySignature(query);
      const cursor = query.cursor
        ? decodeCursor(query.cursor, signature, sort)
        : null;
      const conditions = [eq(records.ownerId, ownerId)];
      const latestRunInputVersion = sql<number | null>`(
        select snapshot.analysis_input_version
        from analysis_runs run
        inner join analysis_snapshots snapshot on snapshot.id = run.snapshot_id
        where run.id = ${records.latestRunId}
          and run.owner_id = ${ownerId}
          and run.record_id = ${records.id}
          and run.status in ('completed', 'partial')
      )`;
      if (query.text) {
        conditions.push(
          or(
            ilike(records.name, `%${query.text}%`),
            ilike(records.code, `%${query.text}%`),
            ilike(records.description, `%${query.text}%`),
          )!,
        );
      }
      if (query.locationId === null) {
        conditions.push(isNull(records.locationId));
      } else if (query.locationId) {
        conditions.push(eq(records.locationId, query.locationId));
      }
      if (query.categoryIds?.length) {
        conditions.push(
          sql`exists (select 1 from record_categories c where c.record_id = ${records.id} and c.category_id in (${sql.join(
            query.categoryIds.map((id) => sql`${id}`),
            sql`, `,
          )}))`,
        );
      }
      if (query.materialIds?.length) {
        conditions.push(
          sql`exists (select 1 from record_materials m where m.record_id = ${records.id} and m.material_id in (${sql.join(
            query.materialIds.map((id) => sql`${id}`),
            sql`, `,
          )}))`,
        );
      }
      if (query.tags?.length) {
        conditions.push(
          sql`exists (select 1 from record_tags t where t.record_id = ${records.id} and t.tag in (${sql.join(
            query.tags.map((tag) => sql`${tag}`),
            sql`, `,
          )}))`,
        );
      }
      if (query.hasPendingChecks !== undefined) {
        const pendingCheck = sql`exists (select 1 from record_checks c where c.record_id = ${records.id} and c.owner_id = ${ownerId} and c.progress <> 'recorded')`;
        conditions.push(
          query.hasPendingChecks ? pendingCheck : sql`not ${pendingCheck}`,
        );
      }
      if (query.freshness === 'unanalyzed') {
        conditions.push(isNull(records.latestRunId));
      } else if (query.freshness === 'current') {
        conditions.push(
          sql`${latestRunInputVersion} = ${records.analysisInputVersion}`,
        );
      } else if (query.freshness === 'outdated') {
        conditions.push(
          sql`${latestRunInputVersion} <> ${records.analysisInputVersion}`,
        );
      }
      if (cursor) {
        if (sort === 'updated') {
          conditions.push(
            or(
              lt(records.updatedAt, cursor.value!),
              and(
                eq(records.updatedAt, cursor.value!),
                lt(records.id, cursor.id),
              ),
            )!,
          );
        } else if (sort === 'code') {
          conditions.push(
            or(
              gt(records.code, cursor.value!),
              and(eq(records.code, cursor.value!), gt(records.id, cursor.id)),
            )!,
          );
        } else if (cursor.value === null) {
          conditions.push(
            and(isNull(records.name), gt(records.id, cursor.id))!,
          );
        } else {
          conditions.push(
            sql`(${records.name} > ${cursor.value} or (${records.name} = ${cursor.value} and ${records.id} > ${cursor.id}) or ${records.name} is null)`,
          );
        }
      }
      const order =
        sort === 'updated'
          ? [desc(records.updatedAt), desc(records.id)]
          : sort === 'code'
            ? [asc(records.code), asc(records.id)]
            : [sql`${records.name} asc nulls last`, asc(records.id)];
      const rows = await tx
        .select()
        .from(records)
        .where(and(...conditions))
        .orderBy(...order)
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const [pageLocations, pendingChecks, latestRunInputVersions] =
        await Promise.all([
          tx
            .select({ id: locations.id, label: locations.label })
            .from(locations)
            .where(
              and(
                eq(locations.ownerId, ownerId),
                inArray(
                  locations.id,
                  page.flatMap((row) =>
                    row.locationId ? [row.locationId] : [],
                  ),
                ),
              ),
            ),
          tx
            .select({
              recordId: recordChecks.recordId,
              count: sql<number>`count(*)::int`,
            })
            .from(recordChecks)
            .where(
              and(
                eq(recordChecks.ownerId, ownerId),
                inArray(
                  recordChecks.recordId,
                  page.map((row) => row.id),
                ),
                sql`${recordChecks.progress} <> 'recorded'`,
              ),
            )
            .groupBy(recordChecks.recordId),
          readLatestRunInputVersions(
            page.flatMap((row) => (row.latestRunId ? [row.latestRunId] : [])),
          ),
        ]);
      const locationLabels = new Map(
        pageLocations.map((location) => [location.id, location.label]),
      );
      const pendingCounts = new Map(
        pendingChecks.map((check) => [check.recordId, check.count]),
      );
      const items = page.map((row): RecordSummary => ({
        id: row.id,
        code: row.code,
        name: row.name,
        coverThumbnail: null,
        locationLabel: row.locationId
          ? (locationLabels.get(row.locationId) ?? null)
          : null,
        analysisFreshness: calculateAnalysisFreshness(
          row.latestRunId
            ? (latestRunInputVersions.get(row.latestRunId) ?? null)
            : null,
          row.analysisInputVersion,
        ),
        pendingCheckCount: pendingCounts.get(row.id) ?? 0,
      }));
      const last = page.at(-1);

      return {
        items,
        nextCursor:
          rows.length > limit && last
            ? encodeCursor({
                signature,
                sort,
                value:
                  sort === 'updated'
                    ? last.updatedAt
                    : sort === 'code'
                      ? last.code
                      : last.name,
                id: last.id,
              })
            : null,
      };
    },
  };
}

/**
 * binds flat location labels to the authenticated collector
 * @param tx
 * @param ownerId
 */
export function createLocationRepository(
  tx: Transaction,
  ownerId: string,
): LocationRepository {
  return {
    /** */
    async query() {
      return tx
        .select({ id: locations.id, label: locations.label })
        .from(locations)
        .where(eq(locations.ownerId, ownerId))
        .orderBy(asc(locations.label));
    },
    async findByLabel(label) {
      const [row] = await tx
        .select({ id: locations.id, label: locations.label })
        .from(locations)
        .where(
          and(
            eq(locations.ownerId, ownerId),
            eq(
              locations.normalizedLabel,
              label.trim().toLocaleLowerCase('en-US'),
            ),
          ),
        );

      return row ?? null;
    },
    async create(location) {
      const normalizedLabel = location.label.trim().toLocaleLowerCase('en-US');
      const [created] = await tx
        .insert(locations)
        .values({ ...location, ownerId, normalizedLabel })
        .onConflictDoNothing({
          target: [locations.ownerId, locations.normalizedLabel],
        })
        .returning({ id: locations.id, label: locations.label });
      if (created) {
        return created;
      }
      const [existing] = await tx
        .select({ id: locations.id, label: locations.label })
        .from(locations)
        .where(
          and(
            eq(locations.ownerId, ownerId),
            eq(locations.normalizedLabel, normalizedLabel),
          ),
        );
      if (!existing) {
        throw new Error('Conflicting location could not be resolved');
      }

      return existing;
    },
  };
}
