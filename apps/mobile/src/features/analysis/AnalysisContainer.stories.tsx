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
} from '../../mobile.stories.fixtures';
import { findStoryElement, findStoryText } from '../../mobile.stories.helpers';

import { AnalysisContainer } from './AnalysisContainer';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import type { ReactElement } from 'react';

import type { StoryResponses } from '../../mobile.stories.fixtures';

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

const successResponses = {
  [`GET /v1/analyses/${storyRunId}`]: completedRun,
  [`GET /v1/records/${storyRecord.id}`]: storyRecord,
  [`POST /v1/analyses/${storyRunId}/apply`]: storyRecord,
};

/**
 * Renders an analysis story whose fixture persists proposal adoption.
 * @param args Analysis container properties.
 * @returns Stateful completed-analysis story surface.
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
