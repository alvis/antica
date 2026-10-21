import { createHash } from 'node:crypto';

import { ComponentInUseError } from '@antica/application/ports';
import { calculateAnalysisFreshness } from '@antica/domain';

import { Prisma } from '../generated/client.js';

import { queryRecordHistory } from './record-history.js';

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
    const rows = await tx.analysisRuns.findMany({
      select: {
        id: true,
        analysisSnapshots: { select: { analysisInputVersion: true } },
      },
      where: {
        ownerId,
        id: { in: [...runIds] },
        status: { in: ['completed', 'partial'] },
      },
    });

    return new Map(
      rows.map(
        (row) => [row.id, row.analysisSnapshots.analysisInputVersion] as const,
      ),
    );
  }

  async function get(id: string): Promise<RecordDetail | null> {
    const row = await tx.records.findFirst({ where: { id, ownerId } });
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
      tx.recordComponents.findMany({
        where: { recordId: id },
        orderBy: { ordinal: 'asc' },
      }),
      tx.recordCategories.findMany({ where: { recordId: id } }),
      tx.recordMaterials.findMany({ where: { recordId: id } }),
      tx.recordTags.findMany({ where: { recordId: id } }),
      tx.recordMeasurements.findMany({ where: { recordId: id } }),
      tx.recordAcquisitions.findMany({ where: { recordId: id } }),
      tx.recordReceipts.findMany({
        select: { assetId: true },
        where: { recordId: id },
      }),
      tx.mediaAssets.findMany({
        select: { id: true },
        where: { recordId: id, ownerId },
      }),
      tx.recordChecks.findMany({
        select: { id: true },
        where: { recordId: id, ownerId },
      }),
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
        seatHeight: dimension('seatHeight'),
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
        amount: acquisition?.amount?.toFixed(2) ?? undefined,
        currency: acquisition?.currency ?? undefined,
        receiptAssetIds: receipts.map((item) => item.assetId),
        provenanceNote: acquisition?.provenanceNote ?? undefined,
      },
      tags: tags.map((item) => item.tag),
      description: row.description,
      collectorJudgment: row.collectorJudgment,
      condition: row.condition,
      surface: row.surface,
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
    const result = await tx.$queryRaw<Array<{ value: bigint }>>(Prisma.sql`
      insert into sequence_counters (owner_id, kind, next_value) values (${ownerId}, 'record', 2)
      on conflict (owner_id, kind) do update set next_value = sequence_counters.next_value + 1
      returning next_value - 1 as value
    `);

    return `AC-${String(result[0]?.value).padStart(6, '0')}`;
  }

  async function saveRelations(
    id: string,
    fields: RecordPatch['fields'],
  ): Promise<void> {
    let removedComponentIds: string[] = [];
    if (fields.components) {
      const existing = await tx.recordComponents.findMany({
        select: { id: true },
        where: { recordId: id },
      });
      const existingIds = new Set(existing.map((item) => item.id));
      const requestedIds = new Set(fields.components.map((item) => item.id));
      removedComponentIds = existing
        .filter((item) => !requestedIds.has(item.id))
        .map((item) => item.id);
      if (existing.length) {
        await tx.$executeRaw(
          Prisma.sql`update record_components set ordinal = -ordinal - 1 where record_id = ${id}::uuid`,
        );
      }
      for (const [ordinal, item] of fields.components.entries()) {
        if (existingIds.has(item.id)) {
          await tx.recordComponents.updateMany({
            data: { label: item.label, ordinal },
            where: { id: item.id, recordId: id },
          });
        } else {
          await tx.recordComponents.create({
            data: { ...item, recordId: id, ownerId, ordinal },
          });
        }
      }
    }
    if (fields.categoryIds) {
      await tx.recordCategories.deleteMany({ where: { recordId: id } });
      if (fields.categoryIds.length) {
        await tx.recordCategories.createMany({
          data: fields.categoryIds.map((categoryId) => ({
            recordId: id,
            categoryId,
          })),
        });
      }
    }
    if (fields.materialIds) {
      await tx.recordMaterials.deleteMany({ where: { recordId: id } });
      if (fields.materialIds.length) {
        await tx.recordMaterials.createMany({
          data: fields.materialIds.map((materialId) => ({
            recordId: id,
            materialId,
          })),
        });
      }
    }
    if (fields.tags) {
      await tx.recordTags.deleteMany({ where: { recordId: id } });
      if (fields.tags.length) {
        await tx.recordTags.createMany({
          data: fields.tags.map((tag) => ({ recordId: id, tag })),
        });
      }
    }
    if (fields.dimensions) {
      for (const kind of [
        'height',
        'width',
        'depth',
        'diameter',
        'seatHeight',
        'weight',
      ] as const) {
        if (!(kind in fields.dimensions)) {
          continue;
        }
        const value = fields.dimensions[kind];
        await tx.recordMeasurements.deleteMany({
          where: { recordId: id, kind },
        });
        if (value) {
          await tx.recordMeasurements.create({
            data: {
              recordId: id,
              kind,
              value: String(value.value),
              unit: value.unit,
              componentId: value.componentId ?? null,
            },
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
      await tx.recordAcquisitions.upsert({
        where: { recordId: id },
        create: { recordId: id, ...acquisition },
        update: acquisition,
      });
      await tx.recordReceipts.deleteMany({ where: { recordId: id } });
      if (value.receiptAssetIds.length) {
        await tx.recordReceipts.createMany({
          data: value.receiptAssetIds.map((assetId) => ({
            recordId: id,
            assetId,
          })),
        });
      }
    }
    for (const componentId of removedComponentIds) {
      try {
        await tx.recordComponents.deleteMany({
          where: { id: componentId, recordId: id },
        });
      } catch (error) {
        const cause = error as { cause?: { code?: string }; code?: string };
        if (
          cause.code === 'P2003' ||
          cause.code === '23503' ||
          cause.cause?.code === '23503'
        ) {
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
      const rows = await tx.$queryRaw<
        Array<{
          recordId: string;
          assetOrDerivativeId: string;
          storageKey: string;
        }>
      >(Prisma.sql`
        select distinct on (asset.record_id) record.id as "recordId", derivative.id as "assetOrDerivativeId", derivative.object_key as "storageKey"
        from media_assets asset
        inner join records record on record.id = asset.record_id and record.owner_id = ${ownerId}
        inner join media_derivatives derivative on derivative.original_asset_id = asset.id and derivative.owner_id = ${ownerId} and derivative.kind = 'thumbnail'
        where asset.owner_id = ${ownerId} and asset.record_id in (${Prisma.join(recordIds.map((id) => Prisma.sql`${id}::uuid`))})
          and asset.kind = 'photo' and asset.purpose = 'object' and asset.state = 'ready'
        order by asset.record_id asc, asset.created_at asc, asset.id asc, derivative.id asc
      `);

      return rows;
    },

    async create(record): Promise<void> {
      await tx.records.create({
        data: {
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
          condition: record.condition,
          surface: record.surface,
          recordRevision: record.recordRevision,
          analysisInputVersion: record.analysisInputVersion,
          evidenceVersion: record.evidenceVersion,
          latestRunId: record.latestRunId,
        },
      });
      await saveRelations(record.id, record);
    },

    async patch(
      id: string,
      patch: RecordPatch,
      versions: RecordVersions,
    ): Promise<RecordDetail | null> {
      const fields = patch.fields;
      const updates = {
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
        condition: fields.condition,
        surface: fields.surface,
        recordRevision: versions.recordRevision,
        analysisInputVersion: versions.analysisInputVersion,
        evidenceVersion: versions.evidenceVersion,
      };
      const assignments = Object.entries(updates)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => {
          const column = Prisma.raw(
            key.replace(/[A-Z]/g, (letter) => '_' + letter.toLowerCase()),
          );
          const parameter =
            key === 'locationId' ? Prisma.sql`${value}::uuid` : value;

          return Prisma.sql`${column} = ${parameter}`;
        });
      const changed = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        update records set ${Prisma.join(assignments)}, updated_at = now()
        where id = ${id}::uuid and owner_id = ${ownerId} and record_revision = ${patch.expectedRevision}
        returning id
      `);
      if (!changed.length) {
        return null;
      }
      await saveRelations(id, fields);

      return get(id);
    },
    /**
     * reads both suggestion flows' adoption history for one owned record
     * @param id record identifier
     * @param query opaque cursor and page size
     * @returns newest-first history page
     */
    async queryHistory(id, query) {
      return queryRecordHistory({ tx, ownerId }, id, query);
    },
    /**
     * @param id
     * @param expectedRevision
     * @param changes
     * @param changes.analysisInput
     * @param changes.evidence
     */
    async bumpVersions(
      id: string,
      expectedRevision: number,
      changes: { readonly analysisInput: boolean; readonly evidence: boolean },
    ): Promise<RecordVersions | null> {
      const [row] = await tx.$queryRaw<RecordVersions[]>(Prisma.sql`
        update records set record_revision = record_revision + 1,
          analysis_input_version = analysis_input_version + ${changes.analysisInput ? 1 : 0},
          evidence_version = evidence_version + ${changes.evidence ? 1 : 0}, updated_at = now()
        where id = ${id}::uuid and owner_id = ${ownerId} and record_revision = ${expectedRevision}
        returning record_revision as "recordRevision", analysis_input_version as "analysisInputVersion", evidence_version as "evidenceVersion"
      `);

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
      const conditions = [Prisma.sql`record.owner_id = ${ownerId}`];
      const latestRunInputVersion = Prisma.sql`(
        select snapshot.analysis_input_version from analysis_runs run
        inner join analysis_snapshots snapshot on snapshot.id = run.snapshot_id
        where run.id = record.latest_run_id and run.owner_id = ${ownerId}
          and run.record_id = record.id and run.status in ('completed', 'partial')
      )`;
      if (query.text) {
        const text = `%${query.text}%`;
        conditions.push(
          Prisma.sql`(record.name ilike ${text} or record.code ilike ${text} or record.description ilike ${text})`,
        );
      }
      if (query.locationId === null) {
        conditions.push(Prisma.sql`record.location_id is null`);
      } else if (query.locationId) {
        conditions.push(
          Prisma.sql`record.location_id = ${query.locationId}::uuid`,
        );
      }
      if (query.categoryIds?.length) {
        const ids = query.categoryIds.map((id) => Prisma.sql`${id}::uuid`);
        conditions.push(
          Prisma.sql`exists (select 1 from record_categories c where c.record_id = record.id and c.category_id in (${Prisma.join(ids)}))`,
        );
      }
      if (query.materialIds?.length) {
        const ids = query.materialIds.map((id) => Prisma.sql`${id}::uuid`);
        conditions.push(
          Prisma.sql`exists (select 1 from record_materials m where m.record_id = record.id and m.material_id in (${Prisma.join(ids)}))`,
        );
      }
      if (query.tags?.length) {
        conditions.push(
          Prisma.sql`exists (select 1 from record_tags t where t.record_id = record.id and t.tag in (${Prisma.join(query.tags)}))`,
        );
      }
      if (query.hasPendingChecks !== undefined) {
        const pendingCheck = Prisma.sql`exists (select 1 from record_checks c where c.record_id = record.id and c.owner_id = ${ownerId} and c.progress <> 'recorded')`;
        conditions.push(
          query.hasPendingChecks
            ? pendingCheck
            : Prisma.sql`not ${pendingCheck}`,
        );
      }
      if (query.freshness === 'unanalyzed') {
        conditions.push(Prisma.sql`record.latest_run_id is null`);
      } else if (query.freshness === 'current') {
        conditions.push(
          Prisma.sql`${latestRunInputVersion} = record.analysis_input_version`,
        );
      } else if (query.freshness === 'outdated') {
        conditions.push(
          Prisma.sql`${latestRunInputVersion} <> record.analysis_input_version`,
        );
      }
      if (cursor) {
        if (sort === 'updated') {
          conditions.push(
            Prisma.sql`(record.updated_at < ${cursor.value}::timestamptz or (record.updated_at = ${cursor.value}::timestamptz and record.id < ${cursor.id}::uuid))`,
          );
        } else if (sort === 'code') {
          conditions.push(
            Prisma.sql`(record.code > ${cursor.value} or (record.code = ${cursor.value} and record.id > ${cursor.id}::uuid))`,
          );
        } else if (cursor.value === null) {
          conditions.push(
            Prisma.sql`(record.name is null and record.id > ${cursor.id}::uuid)`,
          );
        } else {
          conditions.push(
            Prisma.sql`(record.name > ${cursor.value} or (record.name = ${cursor.value} and record.id > ${cursor.id}::uuid) or record.name is null)`,
          );
        }
      }
      const order =
        sort === 'updated'
          ? Prisma.sql`record.updated_at desc, record.id desc`
          : sort === 'code'
            ? Prisma.sql`record.code asc, record.id asc`
            : Prisma.sql`record.name asc nulls last, record.id asc`;
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          code: string;
          name: string | null;
          locationId: string | null;
          latestRunId: string | null;
          analysisInputVersion: number;
          updatedAt: string;
        }>
      >(Prisma.sql`
        select record.id, record.code, record.name, record.location_id as "locationId",
          record.latest_run_id as "latestRunId", record.analysis_input_version as "analysisInputVersion",
          record.updated_at::text as "updatedAt"
        from records record where ${Prisma.join(conditions, ' and ')}
        order by ${order} limit ${limit + 1}
      `);
      const page = rows.slice(0, limit);
      const [pageLocations, pendingChecks, latestRunInputVersions] =
        await Promise.all([
          tx.locations.findMany({
            select: { id: true, label: true },
            where: {
              ownerId,
              id: {
                in: page.flatMap((row) =>
                  row.locationId ? [row.locationId] : [],
                ),
              },
            },
          }),
          tx.recordChecks.groupBy({
            by: ['recordId'],
            _count: { _all: true },
            where: {
              ownerId,
              recordId: { in: page.map((row) => row.id) },
              progress: { not: 'recorded' },
            },
          }),
          readLatestRunInputVersions(
            page.flatMap((row) => (row.latestRunId ? [row.latestRunId] : [])),
          ),
        ]);
      const locationLabels = new Map(
        pageLocations.map((location) => [location.id, location.label]),
      );
      const pendingCounts = new Map(
        pendingChecks.map((check) => [check.recordId, check._count._all]),
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
      return tx.locations.findMany({
        select: { id: true, label: true },
        where: { ownerId },
        orderBy: { label: 'asc' },
      });
    },

    async findByLabel(label) {
      return tx.locations.findFirst({
        select: { id: true, label: true },
        where: {
          ownerId,
          normalizedLabel: label.trim().toLocaleLowerCase('en-US'),
        },
      });
    },

    async create(location) {
      const normalizedLabel = location.label.trim().toLocaleLowerCase('en-US');
      const [created] = await tx.$queryRaw<
        Array<{ id: string; label: string }>
      >(Prisma.sql`
        insert into locations (id, owner_id, label, normalized_label)
        values (${location.id}::uuid, ${ownerId}, ${location.label}, ${normalizedLabel})
        on conflict (owner_id, normalized_label) do nothing returning id, label
      `);
      if (created) {
        return created;
      }
      const existing = await tx.locations.findFirst({
        select: { id: true, label: true },
        where: { ownerId, normalizedLabel },
      });
      if (!existing) {
        throw new Error('Conflicting location could not be resolved');
      }

      return existing;
    },
  };
}
