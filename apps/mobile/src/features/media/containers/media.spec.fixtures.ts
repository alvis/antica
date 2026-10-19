import {
  mediaDetailSchema,
  preparedFrameResultSchema,
} from '@antica/contracts';

import { collectionRecord } from '../../../mobile.spec.fixtures';

export const assetId = '00000000-0000-4000-8000-000000000020';
export const derivativeId = '00000000-0000-4000-8000-000000000021';
export const viewId = '00000000-0000-4000-8000-000000000022';
export const jobId = '00000000-0000-4000-8000-000000000023';
export const prepared = preparedFrameResultSchema.parse({
  originalAssetId: assetId,
  frame: {
    streamIndex: 0,
    timeBase: { numerator: 1, denominator: 25 },
    pts: '37',
    frameDerivativeId: derivativeId,
    displayTimeMs: 1480,
  },
  view: {
    id: viewId,
    originalAssetId: assetId,
    derivativeId,
    width: 640,
    height: 480,
    originalCoordinateSpace: 'video_frame_pixels',
    transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  },
});
export const media = mediaDetailSchema.parse({
  asset: {
    id: assetId,
    owner: { kind: 'record', recordId: collectionRecord.id },
    kind: 'video',
    purpose: 'object',
    state: 'ready',
    componentIds: [],
    originalFileName: 'inspection.mp4',
    mimeType: 'video/mp4',
    byteLength: 100,
    sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    durationMs: 5000,
    views: [prepared.view],
    createdAt: collectionRecord.createdAt,
  },
  reads: [
    {
      assetOrDerivativeId: derivativeId,
      url: 'https://private.example/frame',
      expiresAt: '2027-01-01T00:00:00.000Z',
    },
  ],
  anchors: [],
  processingJobId: null,
  versions: null,
});
export const completedJob = {
  id: jobId,
  kind: 'media',
  state: { kind: 'succeeded' },
  result: prepared,
};
