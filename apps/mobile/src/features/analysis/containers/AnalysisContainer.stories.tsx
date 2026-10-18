import { useMemo, useRef } from 'react';

import {
  analysisRunDetailSchema,
  applyAnalysisChangesSchema,
  recordDetailSchema,
} from '@antica/contracts';

import {
  MobileStoryShell,
  storyRecord,
  storyRunId,
} from '../../../mobile.stories.fixtures';
import {
  findStoryElement,
  findStoryText,
} from '../../../mobile.stories.helpers';

import { expect } from 'storybook/test';

import { AnalysisContainer } from './AnalysisContainer';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import type { ReactElement } from 'react';

import type { StoryResponses } from '../../../mobile.stories.fixtures';

import type { AnalysisContainerProps } from './AnalysisContainer';

const firstProposalId = '00000000-0000-4000-8000-000000000011';
const secondProposalId = '00000000-0000-4000-8000-000000000012';
const completedProposals = [
  {
    id: firstProposalId,
    field: 'name',
    before: storyRecord.name,
    proposed: 'Late Qing blue-and-white bowl',
    findingIds: [],
  },
  {
    id: secondProposalId,
    field: 'description',
    before: storyRecord.description,
    proposed:
      'Porcelain bowl with cobalt floral decoration and light foot wear.',
    findingIds: [],
  },
];

const completedRun = analysisRunDetailSchema.parse({
  runId: storyRunId,
  recordId: storyRecord.id,
  jobId: storyRunId,
  status: 'completed',
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
  result: {
    actionStates: [],
    proposalStates: [],
    output: {
      summary:
        'The decoration and foot wear support a late Qing attribution, pending a base-mark inspection.',
      findings: [
        {
          id: '00000000-0000-4000-8000-000000000014',
          kind: 'visualObservation',
          text: 'Cobalt decoration varies slightly across the floral border.',
          evidenceIds: [],
          observationIds: [],
          citationIds: [],
          relation: 'supports',
          certainty: 'observed',
        },
      ],
      uncertainties: ['The base mark has not yet been photographed.'],
      suggestedMethodIds: [],
      nextActions: [],
      proposedChanges: completedProposals,
    },
  },
});

const photoActionId = '00000000-0000-4000-8000-000000000016';
const describeActionId = '00000000-0000-4000-8000-000000000017';
const storyCheckId = '00000000-0000-4000-8000-000000000018';

/**
 * builds a completed run whose action cards stand in the given saved states (C04, PT-13)
 * @param status saved state of both actions
 * @returns a parsed run with a checked photo action and an unchecked describe action
 */
function actionRun(
  status: 'pending' | 'supplied',
): ReturnType<typeof analysisRunDetailSchema.parse> {
  const state = {
    runId: storyRunId,
    recordId: storyRecord.id,
    revision: 1,
    status,
    latestResolutionId: null,
    updatedAt: storyRecord.updatedAt,
  };

  return analysisRunDetailSchema.parse({
    ...completedRun,
    result: {
      ...completedRun.result,
      actionStates: [
        { ...state, actionId: photoActionId },
        { ...state, actionId: describeActionId },
      ],
      output: {
        ...completedRun.result.output,
        nextActions: [
          {
            id: photoActionId,
            checkId: storyCheckId,
            kind: 'capturePhoto',
            instruction: '補拍底部全貌',
            reason: '讓圈足與底面完整入鏡，用來檢查圈足與修整痕跡。',
          },
          {
            id: describeActionId,
            kind: 'describe',
            instruction: '描述底部觸感',
            reason: '觸感無法從照片判斷。',
          },
        ],
      },
    },
  });
}

const successResponses = {
  [`GET /v1/analyses/${storyRunId}`]: completedRun,
  [`GET /v1/records/${storyRecord.id}`]: storyRecord,
  [`POST /v1/analyses/${storyRunId}/apply`]: storyRecord,
};

/**
 * renders an analysis story whose fixture persists proposal adoption
 * @param args analysis container properties.
 * @returns stateful completed-analysis story surface
 */
function CompletedAnalysisStory(
  args: Readonly<AnalysisContainerProps>,
): ReactElement {
  const currentRun = useRef(completedRun);
  const currentRecord = useRef(storyRecord);
  const responses = useMemo<StoryResponses>(
    () => ({
      [`GET /v1/analyses/${storyRunId}`]: () => currentRun.current,
      [`GET /v1/records/${storyRecord.id}`]: () => currentRecord.current,
      [`POST /v1/analyses/${storyRunId}/apply`]: async (request) => {
        const application = applyAnalysisChangesSchema.parse(
          await request.json(),
        );
        const selected = new Set(application.selectedProposalIds);
        const appliedFields = Object.fromEntries(
          completedProposals
            .filter((change) => selected.has(change.id))
            .map((change) => [change.field, change.proposed]),
        );
        currentRecord.current = recordDetailSchema.parse({
          ...currentRecord.current,
          ...appliedFields,
          recordRevision: currentRecord.current.recordRevision + 1,
          analysisInputVersion: currentRecord.current.analysisInputVersion + 1,
        });
        currentRun.current = analysisRunDetailSchema.parse({
          ...currentRun.current,
          result: {
            ...currentRun.current.result,
            proposalStates: completedProposals.map((change) => ({
              proposalId: change.id,
              status: selected.has(change.id) ? 'accepted' : 'pending',
              latestAdoptionEventId: selected.has(change.id)
                ? '00000000-0000-4000-8000-000000000015'
                : null,
            })),
          },
        });

        return currentRecord.current;
      },
    }),
    [],
  );

  return (
    <MobileStoryShell responses={responses}>
      <AnalysisContainer {...args} />
    </MobileStoryShell>
  );
}

const meta = {
  title: 'Mobile/Features/Analysis/AnalysisContainer',
  component: AnalysisContainer,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: { runId: storyRunId },
  argTypes: {
    runId: {
      control: 'text',
      description: 'Analysis run identifier loaded from the authenticated API.',
    },
  },
} satisfies Meta<typeof AnalysisContainer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CompletedWithProposals = {
  render: (args) => <CompletedAnalysisStory {...args} />,
  play: async ({ canvasElement }) => {
    const checkbox = await findStoryElement(canvasElement, '[role="checkbox"]');
    checkbox.click();
    const apply = await findStoryElement(
      canvasElement,
      '[role="button"][aria-label*="Apply selected changes (1)"]',
    );
    apply.click();
    await findStoryText(canvasElement, 'POST /v1/analyses/');
    await findStoryText(canvasElement, 'Accepted');
  },
} satisfies Story;

export const Loading = {
  render: (args) => (
    <MobileStoryShell responses={successResponses} delayMs={60_000}>
      <AnalysisContainer {...args} />
    </MobileStoryShell>
  ),
} satisfies Story;

export const FailedInTraditionalChinese = {
  render: (args) => (
    <MobileStoryShell
      locale="zh-Hant"
      responses={{
        [`GET /v1/analyses/${storyRunId}`]: {
          storyError: {
            status: 503,
            code: 'ANALYSIS_UNAVAILABLE',
            message: '分析服務暫時無法使用。',
          },
        },
      }}>
      <AnalysisContainer {...args} />
    </MobileStoryShell>
  ),
} satisfies Story;

/** C04 as in the mockup: a checked photo action and an action without a check, both actionable */
export const ActionCardsInTraditionalChinese = {
  render: (args) => (
    <MobileStoryShell
      locale="zh-Hant"
      responses={{
        [`GET /v1/analyses/${storyRunId}`]: actionRun('pending'),
        [`GET /v1/records/${storyRecord.id}`]: storyRecord,
      }}>
      <AnalysisContainer {...args} />
    </MobileStoryShell>
  ),
  play: async ({ canvasElement }) => {
    await findStoryText(canvasElement, '補拍底部全貌');
    await findStoryElement(
      canvasElement,
      `[data-testid="analysis-action-status-pending-${photoActionId}"]`,
    );
    await findStoryText(canvasElement, '待補資料');
    await findStoryText(canvasElement, '用來檢查：實查 00000000');
    await findStoryElement(
      canvasElement,
      `[data-testid="analysis-action-capture-${photoActionId}"][aria-label="補拍照片"]`,
    );
    await findStoryElement(
      canvasElement,
      `[data-testid="analysis-action-describe-${describeActionId}"][aria-label="補充描述"]`,
    );
    (
      await findStoryElement(
        canvasElement,
        `[data-testid="analysis-action-capture-${photoActionId}"]`,
      )
    ).click();
  },
} satisfies Story;

/** PT-13: reopening keeps supplied actions supplied, without capture controls */
export const SuppliedActionsReopened = {
  render: (args) => (
    <MobileStoryShell
      responses={{
        [`GET /v1/analyses/${storyRunId}`]: actionRun('supplied'),
        [`GET /v1/records/${storyRecord.id}`]: storyRecord,
      }}>
      <AnalysisContainer {...args} />
    </MobileStoryShell>
  ),
  play: async ({ canvasElement }) => {
    await findStoryElement(
      canvasElement,
      `[data-testid="analysis-action-status-supplied-${photoActionId}"]`,
    );
    await findStoryElement(
      canvasElement,
      `[data-testid="analysis-action-status-supplied-${describeActionId}"]`,
    );
    await expect(
      canvasElement.querySelector(
        `[data-testid="analysis-action-capture-${photoActionId}"]`,
      ),
    ).toBeNull();
  },
} satisfies Story;
