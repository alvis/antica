import { recordHistoryEntrySchema } from '@antica/contracts';

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

import { RecordHistoryContainer } from './RecordHistoryContainer';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import type { StoryResponses } from '../../../mobile.stories.fixtures';

const historyPath = `GET /v1/records/${storyRecord.id}/history`;
const proposalId = '00000000-0000-4000-8000-000000000011';
const occurredAt = '2026-10-16T09:30:00.000Z';
const renamed = recordHistoryEntrySchema.parse({
  id: '00000000-0000-4000-8000-000000000921',
  occurredAt,
  status: 'accepted',
  source: { kind: 'analysis', runId: storyRunId, proposalId },
  field: 'name',
  before: 'Blue-and-white bowl',
  after: 'Late Qing blue-and-white bowl',
});
const describedByVoice = recordHistoryEntrySchema.parse({
  id: '00000000-0000-4000-8000-000000000922',
  occurredAt,
  status: 'skipped',
  source: {
    kind: 'editDraft',
    editDraftId: '00000000-0000-4000-8000-000000000923',
    proposalId,
    recordMessageId: null,
  },
  field: 'description',
  before: 'Porcelain bowl.',
  after:
    'Porcelain bowl with cobalt floral decoration, a double ring at the rim, and light wear on the unglazed foot.',
});
const taggedByMessage = recordHistoryEntrySchema.parse({
  id: '00000000-0000-4000-8000-000000000925',
  occurredAt,
  status: 'accepted',
  source: {
    kind: 'editDraft',
    editDraftId: '00000000-0000-4000-8000-000000000926',
    proposalId,
    recordMessageId: '00000000-0000-4000-8000-000000000927',
  },
  field: 'tags',
  before: [],
  after: ['bowl', 'porcelain'],
});
const dated = recordHistoryEntrySchema.parse({
  id: '00000000-0000-4000-8000-000000000924',
  occurredAt: '2026-10-15T08:00:00.000Z',
  status: 'accepted',
  source: { kind: 'analysis', runId: storyRunId, proposalId },
  field: 'period',
  before: null,
  after: {
    label: 'Late Qing',
    fromYear: 1850,
    toYear: 1911,
    status: 'unconfirmed',
  },
});
const pagedResponses: StoryResponses = {
  [historyPath]: (request) =>
    new URL(request.url).searchParams.has('cursor')
      ? { items: [dated], nextCursor: null }
      : {
          items: [renamed, taggedByMessage, describedByVoice],
          nextCursor: 'older',
        },
};

const meta = {
  title: 'Mobile/Features/Collection/RecordHistoryContainer',
  component: RecordHistoryContainer,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: { recordId: storyRecord.id },
  argTypes: {
    recordId: {
      control: 'text',
      description: 'Record whose written changes are listed.',
    },
  },
} satisfies Meta<typeof RecordHistoryContainer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ChangesWithOlderPage = {
  render: (args) => (
    <MobileStoryShell responses={pagedResponses}>
      <RecordHistoryContainer {...args} />
    </MobileStoryShell>
  ),
  play: async ({ canvasElement }) => {
    await findStoryText(canvasElement, 'Late Qing blue-and-white bowl');
    await findStoryText(canvasElement, 'Wrote “Tags” after confirming in Chat');
    if (
      canvasElement.querySelector(
        `[data-testid="record-history-entry-${describedByVoice.id}"]`,
      )
    ) {
      throw new Error('Skipped suggestions must stay out of change history.');
    }
    await findStoryElement(
      canvasElement,
      `[data-testid="record-history-entry-${taggedByMessage.id}-tags-source"]`,
    );
    (await findStoryButton(canvasElement, 'Show older changes')).click();
    await findStoryText(canvasElement, 'Late Qing (1850–1911)');
  },
} satisfies Story;

export const NoChanges = {
  render: (args) => (
    <MobileStoryShell
      responses={{ [historyPath]: { items: [], nextCursor: null } }}>
      <RecordHistoryContainer {...args} />
    </MobileStoryShell>
  ),
  play: async ({ canvasElement }) => {
    await findStoryText(
      canvasElement,
      'No suggestions have been accepted or skipped yet.',
    );
  },
} satisfies Story;

export const ChangesInTraditionalChinese = {
  render: (args) => (
    <MobileStoryShell locale="zh-Hant" responses={pagedResponses}>
      <RecordHistoryContainer {...args} />
    </MobileStoryShell>
  ),
  play: async ({ canvasElement }) => {
    await findStoryText(canvasElement, '套用分析建議「名稱」');
    await findStoryText(canvasElement, '經對話確認寫入「標籤」');
  },
} satisfies Story;
