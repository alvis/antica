import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it, vi } from 'vitest';

import {
  createAnalysisHandler,
  createAnalysisService,
  createEvidenceService,
  createMediaService,
  createRecordService,
} from '@antica/application/server';
import {
  createDatabase,
  createLocalMediaStore,
  createTransactionPort,
  processImage,
  processVideoFrames,
} from '@antica/platform';
import { createDevelopmentModels } from '@antica/platform/ai';
import { renderCanonicalImage } from '@antica/platform/search';

import type {
  AnalysisModelPort,
  TextRetrievalPort,
  TransactionPort,
} from '@antica/application/ports';

const databaseUrl = process.env.ANTICA_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated migrated acceptance database',
  );
}
const executeFile = promisify(execFile);
const clock = { now: (): string => '2026-10-13T00:00:00.000Z' };
const ids = { create: randomUUID };
const index = {
  embeddingModelId: 'acceptance:no-external-retrieval',
  dimensions: 1,
  indexVersion: '1',
};

describe('Frozen analysis evidence pixels', () => {
  it.each(['image', 'video'] as const)(
    'should submit the selected %s canonical pixels and reject a changed locator before the model',
    async (kind) => {
      const database = createDatabase({ url: databaseUrl });
      const directory = await mkdtemp(
        join(tmpdir(), 'antica-analysis-pixels-'),
      );
      const ownerId = randomUUID();
      const transaction = createTransactionPort(database.db);
      const store = createLocalMediaStore({
        root: join(directory, 'store'),
        publicBaseUrl: 'http://localhost:8080',
        signingSecret:
          'acceptance-analysis-pixel-secret-at-least-32-characters',
      });
      const models = createDevelopmentModels();
      const analyze = vi.fn<AnalysisModelPort['analyze']>(
        async (pack, selection) => models.analysis.analyze(pack, selection),
      );
      const read = vi.fn(async (key: string) => store.read(key));
      const renderRegion = vi.fn(renderCanonicalImage);
      const text: TextRetrievalPort = {
        search: async () => ({
          success: true,
          data: { items: [], nextCursor: null },
        }),
        snapshot: async () => ({
          success: true,
          data: {
            id: randomUUID(),
            index,
            citations: [],
            text: [],
            methods: [],
            createdAt: clock.now(),
          },
        }),
      };
      const analysis = createAnalysisService(
        transaction,
        models.catalog,
        {
          role: 'analysis',
          modelId: 'development:evidence-v1',
          profileVersion: '1',
        },
        clock,
        ids,
      );
      const handler = (selectedTransaction: TransactionPort = transaction) =>
        createAnalysisHandler({
          transaction: selectedTransaction,
          text,
          index,
          model: { analyze },
          catalog: models.catalog,
          media: { read, renderRegion },
          clock,
        });
      try {
        const { bytes, original, selected, anchor, latest, record, region } =
          await seedMediaEvidence({
            transaction,
            store,
            ownerId,
            directory,
            kind,
          });
        const rejectedRun = await analysis.request(
          ownerId,
          record.data.id,
          randomUUID(),
          { expectedRecordRevision: latest.data.recordRevision },
        );
        if (!rejectedRun.success) {
          throw new Error('Analysis fixture failed');
        }
        const changed = changeLocator(transaction, kind);
        expect(
          await handler(changed)(ownerId, rejectedRun.data.jobId),
        ).toMatchObject({
          success: false,
          error: { code: 'EVIDENCE_INVALID' },
        });
        expect(analyze).not.toHaveBeenCalled();
        expect(read).not.toHaveBeenCalled();
        const accepted = await analysis.request(
          ownerId,
          record.data.id,
          randomUUID(),
          { expectedRecordRevision: latest.data.recordRevision },
        );
        if (!accepted.success) {
          throw new Error('Valid analysis fixture failed');
        }
        const extraViewId = await addLaterView({
          transaction,
          store,
          ownerId,
          selected,
        });
        expect(await handler()(ownerId, accepted.data.jobId)).toMatchObject({
          success: true,
        });
        expect(analyze).toHaveBeenCalledTimes(1);
        const pack = analyze.mock.calls[0]![0];
        expect(pack.input.evidenceIds).toEqual([anchor.data.id]);
        expect(pack.images).toHaveLength(1);
        expect(pack.images[0]?.evidenceId).toBe(anchor.data.id);
        expect(read).toHaveBeenCalledExactlyOnceWith(
          selected.derivative.storageKey,
        );
        const canonical = await store.read(selected.derivative.storageKey);
        if (kind === 'image') {
          expect(selected.view).toMatchObject({ width: 4, height: 6 });
          expect(renderRegion).toHaveBeenCalledExactlyOnceWith({
            originalAssetId: original.assetId,
            canonicalViewId: selected.view.id,
            bytes: canonical.bytes,
            region,
          });
          expect(pack.images[0]?.mediaType).toBe('image/png');
          const imagePath = join(directory, 'selected.png');
          await writeFile(imagePath, pack.images[0]!.bytes);
          const actual = await executeFile(
            'ffmpeg',
            [
              '-v',
              'error',
              '-i',
              imagePath,
              '-frames:v',
              '1',
              '-f',
              'rawvideo',
              '-pix_fmt',
              'rgb24',
              'pipe:1',
            ],
            { encoding: 'buffer' },
          );
          const dimensions = await executeFile('ffprobe', [
            '-v',
            'error',
            '-show_entries',
            'stream=width,height',
            '-of',
            'json',
            imagePath,
          ]);
          expect(JSON.parse(dimensions.stdout)).toMatchObject({
            streams: [{ width: 2, height: 3 }],
          });
          expect(actual.stdout).toHaveLength(18);
          const rendered = await renderRegion.mock.results[0]!.value;
          if (!rendered.success) {
            throw new Error('Region renderer failed');
          }
          expect(pack.images[0]?.bytes).toEqual(rendered.data);
        } else {
          expect(renderRegion).not.toHaveBeenCalled();
          expect(pack.images[0]).toMatchObject({
            mediaType: 'image/jpeg',
            bytes: canonical.bytes,
          });
          expect(pack.images[0]?.bytes).not.toEqual(bytes);
          expect(selected.frame).toMatchObject({
            pts: '4096',
            displayTimeMs: 400,
          });
        }
        const stored = await transaction.run(ownerId, async (unit) => ({
          success: true,
          data: await unit.analyses.get(accepted.data.runId),
        }));
        expect(stored.data?.requestedSnapshot.frozenPack.evidence).toEqual([
          anchor.data,
        ]);
        expect(
          stored.data?.requestedSnapshot.frozenPack.media[0]?.views.map(
            (view) => view.id,
          ),
        ).not.toContain(extraViewId);
        expect((await store.read(original.key)).bytes).toEqual(bytes);
      } finally {
        await database.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
    30_000,
  );
});

function changeLocator(
  transaction: TransactionPort,
  kind: 'image' | 'video',
): TransactionPort {
  return {
    run: async (owner, work) =>
      transaction.run(owner, async (unit) =>
        work({
          ...unit,
          media: {
            ...unit.media,
            getCanonicalView: async (id) => {
              const view = await unit.media.getCanonicalView(id);

              return view && kind === 'image'
                ? { ...view, width: view.width + 1 }
                : view;
            },
            getDerivative: async (id) => {
              const derivative = await unit.media.getDerivative(id);

              return derivative?.frame
                ? {
                    ...derivative,
                    frame: { ...derivative.frame, pts: '999999' },
                  }
                : derivative;
            },
          },
        }),
      ),
  };
}

async function prepare(
  store: ReturnType<typeof createLocalMediaStore>,
  original: Parameters<typeof processImage>[0]['original'],
  kind: 'image' | 'video',
) {
  return kind === 'image'
    ? [
        {
          ...(await processImage({
            store,
            original,
            derivativeId: randomUUID(),
            viewId: randomUUID(),
          })),
          frame: null,
        },
      ]
    : (async () => {
        const result = await processVideoFrames({
          store,
          original,
          frames: [
            {
              derivativeId: randomUUID(),
              viewId: randomUUID(),
              displayTimeMs: 0,
            },
            {
              derivativeId: randomUUID(),
              viewId: randomUUID(),
              displayTimeMs: 200,
            },
          ],
        });
        if (!result.success) {
          throw new Error('Video fixture failed');
        }

        return result.data;
      })();
}

async function seedMediaEvidence({
  transaction,
  store,
  ownerId,
  directory,
  kind,
}: {
  readonly transaction: TransactionPort;
  readonly store: ReturnType<typeof createLocalMediaStore>;
  readonly ownerId: string;
  readonly directory: string;
  readonly kind: 'image' | 'video';
}) {
  const records = createRecordService(transaction, clock, ids);
  const evidence = createEvidenceService(transaction, clock, ids);
  const media = createMediaService(transaction, store, clock, ids);
  let bytes = await readFile(
    new URL('./fixtures/orientation-6.jpg', import.meta.url),
  );
  if (kind === 'video') {
    const path = join(directory, 'original.mp4');
    await executeFile('ffmpeg', [
      '-v',
      'error',
      '-nostdin',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=32x24:rate=10:duration=0.5',
      '-vf',
      'setpts=N*N/(10*TB)',
      '-fps_mode',
      'vfr',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      path,
    ]);
    bytes = await readFile(path);
  }
  const record = await records.create(ownerId, randomUUID(), {
    unitKind: 'single',
  });
  if (!record.success) {
    throw new Error('Record fixture failed');
  }
  const upload = await media.start(ownerId, {
    requestKey: randomUUID(),
    target: { kind: 'record', recordId: record.data.id },
    kind: kind === 'video' ? 'video' : 'photo',
    purpose: 'object',
    componentIds: [],
    fileName: kind === 'video' ? 'original.mp4' : 'oriented.jpg',
    mimeType: kind === 'video' ? 'video/mp4' : 'image/jpeg',
    byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  if (!upload.success || upload.data.mode !== 'single') {
    throw new Error('Upload fixture failed');
  }
  const original = {
    assetId: upload.data.assetId,
    key: `originals/${upload.data.assetId}`,
    mimeType: kind === 'video' ? 'video/mp4' : 'image/jpeg',
    byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  await store.acceptUploadToken(
    new URL(upload.data.putUrl).pathname.split('/').at(-1)!,
    bytes,
    original.mimeType,
  );
  expect(
    await media.complete(ownerId, original.assetId, randomUUID()),
  ).toMatchObject({ success: true });
  const prepared = await prepare(store, original, kind);
  const selected = prepared.at(-1)!;
  await transaction.run(ownerId, async (unit) => {
    for (const item of prepared) {
      await unit.media.addDerivative({
        ...item.derivative,
        ...(item.frame ? { frame: item.frame } : {}),
      });
      await unit.media.addCanonicalView(item.view);
    }
    await unit.media.markReadyOnce(original.assetId, 'uploaded');

    return { success: true, data: undefined };
  });
  const region = {
    kind: 'rect' as const,
    x: 0.5,
    y: 0,
    width: 0.5,
    height: 0.5,
  };
  const common = {
    recordId: record.data.id,
    componentIds: [],
    originalAssetId: original.assetId,
    canonicalViewId: selected.view.id,
  };
  const anchor = await evidence.createAnchor(ownerId, {
    requestKey: randomUUID(),
    mode: 'create',
    evidence: selected.frame
      ? {
          ...common,
          kind: 'video_frame',
          scope: { kind: 'whole' },
          frame: selected.frame,
        }
      : {
          ...common,
          kind: 'image',
          scope: { kind: 'region', region, cropDerivativeId: null },
        },
  });
  if (!anchor.success) {
    throw new Error('Anchor fixture failed');
  }
  const latest = await records.get(ownerId, record.data.id);
  if (!latest.success) {
    throw new Error('Record disappeared');
  }

  return { bytes, original, selected, anchor, latest, record, region };
}

async function addLaterView({
  transaction,
  store,
  ownerId,
  selected,
}: {
  readonly transaction: TransactionPort;
  readonly store: ReturnType<typeof createLocalMediaStore>;
  readonly ownerId: string;
  readonly selected: Awaited<ReturnType<typeof prepare>>[number];
}): Promise<string> {
  const id = randomUUID();
  const derivativeId = randomUUID();
  const storageKey = `derivatives/${selected.derivative.originalAssetId}/${derivativeId}`;
  const object = await store.read(selected.derivative.storageKey);
  await store.writeDerivative({ key: storageKey, ...object });
  await transaction.run(ownerId, async (unit) => {
    await unit.media.addDerivative({
      ...selected.derivative,
      id: derivativeId,
      storageKey,
      ...(selected.frame
        ? { frame: { ...selected.frame, frameDerivativeId: derivativeId } }
        : {}),
    });
    await unit.media.addCanonicalView({ ...selected.view, id, derivativeId });

    return { success: true, data: undefined };
  });

  return id;
}
