import { randomUUID } from 'node:crypto';

import { describe, expect, inject } from 'vitest';

import { createLinkedAnalysisEvidence } from '../spec/fixtures/analysis-evidence.js';
import { createDatabaseTest } from '../spec/fixtures/runner.js';
import { createTransactionPort } from '../transaction.js';

import type {
  CommandReceipt,
  TransactionPort,
} from '@antica/application/ports';
import type { RecordDetail } from '@antica/contracts';
import type { EvidenceAnchor, RecordCheck } from '@antica/domain';

import type { LinkedAnalysisEvidence } from '../spec/fixtures/analysis-evidence.js';

const resources = inject('platformDatabases');
const it = createDatabaseTest(resources['evidence-create']!);
const now = '2026-10-13T12:00:00.000Z';

describe('evidence repository transactions', () => {
  it('should atomically retain check fields and both anchor associations while rejecting a stale revision', async ({
    connection,
  }) => {
    const transaction = createTransactionPort(connection.db);
    const ownerId = randomUUID();
    const seeded = await transaction.run(ownerId, async (unit) => ({
      success: true as const,
      data: await createLinkedAnalysisEvidence(unit),
    }));
    const fixture = seeded.data;
    const anchor = { ...fixture.anchor, id: randomUUID(), createdAt: now };
    const updated = {
      ...fixture.check,
      revision: fixture.check.revision + 1,
      updatedAt: now,
      evidenceAnchorIds: [...fixture.check.evidenceAnchorIds, anchor.id],
    };

    const result = await transaction.run(ownerId, async (unit) => {
      await unit.evidence.addAnchor(anchor);

      return {
        success: true as const,
        data: await unit.evidence.updateCheck(updated, fixture.check.revision),
      };
    });
    expect(result).toEqual({ success: true, data: true });
    const context = { fixture, requestKey: randomUUID() };
    const committed = await readState(transaction, ownerId, context);
    expect(committed.check).toEqual(updated);
    expect(committed.anchors).toEqual(
      expect.arrayContaining([fixture.anchor, anchor]),
    );
    expect(committed.anchors).toHaveLength(2);
    const stale = await transaction.run(ownerId, async (unit) => ({
      success: true as const,
      data: await unit.evidence.updateCheck(
        { ...updated, evidenceAnchorIds: [] },
        fixture.check.revision,
      ),
    }));
    expect(stale).toEqual({ success: true, data: false });
    expect(await readState(transaction, ownerId, context)).toEqual(committed);
  });

  it.for(['failed-result', 'receipt-error'] as const)(
    'should roll back anchors, associations, record versions, and receipts after %s',
    async (kind, { connection }) => {
      const transaction = createTransactionPort(connection.db);
      const ownerId = randomUUID();
      const seeded = await transaction.run(ownerId, async (unit) => ({
        success: true as const,
        data: await createLinkedAnalysisEvidence(unit),
      }));
      const fixture = seeded.data;
      const requestKey = randomUUID();
      const receipt: CommandReceipt = {
        ownerId,
        requestKey,
        operation: 'evidence.create',
        fingerprint: randomUUID(),
        status: 201,
        result: { id: fixture.anchor.id },
      };
      const before = await readState(transaction, ownerId, {
        fixture,
        requestKey,
      });
      const failure = {
        success: false as const,
        error: {
          code: 'REVISION_CONFLICT' as const,
          message: 'Consumer rejects the update',
          retryable: true,
        },
      };
      const operation = transaction.run(ownerId, async (unit) => {
        const anchor = { ...fixture.anchor, id: randomUUID(), createdAt: now };
        await unit.evidence.addAnchor(anchor);
        expect(
          await unit.evidence.updateCheck(
            {
              ...fixture.check,
              revision: fixture.check.revision + 1,
              updatedAt: now,
              evidenceAnchorIds: [
                ...fixture.check.evidenceAnchorIds,
                anchor.id,
              ],
            },
            fixture.check.revision,
          ),
        ).toBe(true);
        expect(
          await unit.records.bumpVersions(
            fixture.recordId,
            before.record!.recordRevision,
            { analysisInput: true, evidence: true },
          ),
        ).toEqual({
          recordRevision: before.record!.recordRevision + 1,
          analysisInputVersion: before.record!.analysisInputVersion + 1,
          evidenceVersion: before.record!.evidenceVersion + 1,
        });
        await unit.commands.insert(receipt);
        if (kind === 'receipt-error') {
          await unit.commands.insert(receipt);
        }

        return failure;
      });

      if (kind === 'receipt-error') {
        await expect(operation).rejects.toMatchObject({
          cause: { code: '23505' },
        });
      } else {
        expect(await operation).toEqual(failure);
      }
      expect(
        await readState(transaction, ownerId, { fixture, requestKey }),
      ).toEqual(before);
    },
  );
});

async function readState(
  transaction: TransactionPort,
  ownerId: string,
  {
    fixture,
    requestKey,
  }: { fixture: LinkedAnalysisEvidence; requestKey: string },
): Promise<{
  readonly record: RecordDetail | null;
  readonly check: RecordCheck | null;
  readonly anchors: readonly EvidenceAnchor[];
  readonly receipt: CommandReceipt | null;
}> {
  const result = await transaction.run(ownerId, async (unit) => ({
    success: true as const,
    data: {
      record: await unit.records.get(fixture.recordId),
      check: await unit.evidence.getCheck(fixture.check.id),
      anchors: await unit.evidence.queryAnchorsByAsset(fixture.assetId),
      receipt: await unit.commands.get(ownerId, 'evidence.create', requestKey),
    },
  }));

  return result.data;
}
