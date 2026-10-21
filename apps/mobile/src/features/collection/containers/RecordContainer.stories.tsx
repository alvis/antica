import { analysisRunDetailSchema, mediaDetailSchema } from '@antica/contracts';

import {
  MobileStoryShell,
  storyRecord,
  storyRunId,
} from '../../../mobile.stories.fixtures';
import {
  findStoryButton,
  findStoryElement,
  findStoryText,
} from '../../../mobile.stories.helpers';

import { RecordContainer } from './RecordContainer';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import type { StoryResponses } from '../../../mobile.stories.fixtures';

const emptyPage = { items: [], nextCursor: null };
const storyMediaId = '00000000-0000-4000-8000-000000000020';
const storyMedia = mediaDetailSchema.parse({
  asset: {
    id: storyMediaId,
    owner: { kind: 'record', recordId: storyRecord.id },
    kind: 'video',
    purpose: 'object',
    state: 'ready',
    componentIds: [],
    originalFileName: 'complete-set.mp4',
    mimeType: 'video/mp4',
    byteLength: 100,
    sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    durationMs: 5000,
    views: [],
    createdAt: storyRecord.createdAt,
  },
  reads: [],
  anchors: [],
  processingJobId: null,
  versions: null,
});
const newRunId = '00000000-0000-4000-8000-000000000052';

/**
 * builds the responses of a saved record standing in one analysis state
 * @param record record freshness and latest run
 * @param runStatus status of the latest run, when one exists
 * @returns story responses for the record screen
 */
function analysisStateResponses(
  record: Pick<typeof storyRecord, 'latestRunId' | 'analysisFreshness'>,
  runStatus: 'running' | 'completed' = 'completed',
): StoryResponses {
  return {
    [`GET /v1/records/${storyRecord.id}`]: {
      ...storyRecord,
      ...record,
      mediaIds: [storyMediaId],
    },
    [`GET /v1/media/${storyMediaId}`]: storyMedia,
    [`GET /v1/records/${storyRecord.id}/observations`]: emptyPage,
    [`GET /v1/records/${storyRecord.id}/references`]: emptyPage,
    [`GET /v1/analyses/${storyRunId}`]: analysisRunDetailSchema.parse({
      runId: storyRunId,
      recordId: storyRecord.id,
      jobId: storyRunId,
      status: runStatus,
      snapshot: {
        id: storyRunId,
        recordRevision: storyRecord.recordRevision,
        analysisInputVersion: storyRecord.analysisInputVersion,
        evidenceVersion: storyRecord.evidenceVersion,
        assetIds: [],
        evidenceIds: [],
        observationIds: [],
        checkIds: [],
        retrievalSnapshotId: null,
      },
      citations: [],
      suggestedMethods: [],
      invocation: null,
      failureAudits: [],
      result: { output: null, actionStates: [], proposalStates: [] },
    }),
    [`POST /v1/records/${storyRecord.id}/analyses`]: {
      runId: newRunId,
      jobId: newRunId,
      status: 'queued',
      inputSnapshotId: newRunId,
      analysisInputVersion: storyRecord.analysisInputVersion,
    },
  };
}
const readyResponses = {
  [`GET /v1/records/${storyRecord.id}`]: storyRecord,
  [`GET /v1/records/${storyRecord.id}/observations`]: emptyPage,
  [`GET /v1/records/${storyRecord.id}/references`]: emptyPage,
  'GET /v1/locations': [],
};

const meta = {
  title: 'Mobile/Features/Collection/RecordContainer',
  component: RecordContainer,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: { recordId: storyRecord.id },
  argTypes: {
    recordId: {
      control: 'text',
      description: 'Collection record identifier loaded from the API.',
    },
  },
} satisfies Meta<typeof RecordContainer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** the saved facts, both location fields, and 編輯 in the 資料 header */
export const SavedRecord = {
  render: (args) => (
    <MobileStoryShell responses={readyResponses}>
      <RecordContainer {...args} />
    </MobileStoryShell>
  ),
  play: async ({ canvasElement }) => {
    await findStoryElement(canvasElement, '[data-testid="record-fields"]');
    await findStoryText(canvasElement, 'Study cabinet, shelf 2');
    await findStoryText(canvasElement, '8.4 cm');
    (await findStoryButton(canvasElement, 'Edit')).click();
  },
} satisfies Story;

export const Loading = {
  render: (args) => (
    <MobileStoryShell responses={readyResponses} delayMs={60_000}>
      <RecordContainer {...args} />
    </MobileStoryShell>
  ),
} satisfies Story;

export const OfflineInTraditionalChinese = {
  render: (args) => (
    <MobileStoryShell
      locale="zh-Hant"
      responses={{
        [`GET /v1/records/${storyRecord.id}`]: {
          storyError: {
            status: 503,
            code: 'OFFLINE',
            message: '請連線後重試。',
          },
        },
        [`GET /v1/records/${storyRecord.id}/observations`]: emptyPage,
        [`GET /v1/records/${storyRecord.id}/references`]: emptyPage,
      }}>
      <RecordContainer {...args} />
    </MobileStoryShell>
  ),
} satisfies Story;

/** B06 as in the mockup: saved, not yet analysed, with the Analyse action that starts one run */
export const SavedNotYetAnalysedInTraditionalChinese = {
  render: (args) => (
    <MobileStoryShell
      locale="zh-Hant"
      responses={analysisStateResponses({
        latestRunId: null,
        analysisFreshness: 'unanalyzed',
      })}>
      <RecordContainer {...args} />
    </MobileStoryShell>
  ),
  play: async ({ canvasElement }) => {
    await findStoryElement(
      canvasElement,
      '[data-testid="record-analysis-status-unanalysed"]',
    );
    await findStoryText(canvasElement, '資料已儲存，可隨時開始分析。');
    (await findStoryButton(canvasElement, '開始分析')).click();
    await findStoryText(
      canvasElement,
      `POST /v1/records/${storyRecord.id}/analyses`,
    );
  },
} satisfies Story;

/** a run of the current input is still in progress, so the record waits on it and 建議 links to it */
export const Analysing = {
  render: (args) => (
    <MobileStoryShell
      responses={analysisStateResponses(
        { latestRunId: storyRunId, analysisFreshness: 'unanalyzed' },
        'running',
      )}>
      <RecordContainer {...args} />
    </MobileStoryShell>
  ),
  play: async ({ canvasElement }) => {
    await findStoryElement(
      canvasElement,
      '[data-testid="record-analysis-status-running"]',
    );
    await findStoryText(canvasElement, 'Analyzing');
    await findStoryElement(
      canvasElement,
      '[role="link"][data-testid="record-open-run-segment"]',
    );
  },
} satisfies Story;

/** C05: evidence added after the run waits for the collector to analyse again */
export const NewEvidenceNotYetAnalysed = {
  render: (args) => (
    <MobileStoryShell
      responses={analysisStateResponses({
        latestRunId: storyRunId,
        analysisFreshness: 'outdated',
      })}>
      <RecordContainer {...args} />
    </MobileStoryShell>
  ),
  play: async ({ canvasElement }) => {
    await findStoryElement(
      canvasElement,
      '[data-testid="record-analysis-status-outdated"]',
    );
    await findStoryText(
      canvasElement,
      'New evidence was added after the last analysis. Uploading never starts an analysis.',
    );
    await findStoryButton(canvasElement, 'Analyze again');
    await findStoryElement(
      canvasElement,
      '[role="link"][data-testid="record-open-run-segment"]',
    );
  },
} satisfies Story;
