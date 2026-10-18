import { useMemo, useRef } from 'react';

import {
  editDraftApplySchema,
  editDraftAppliedSchema,
  recordFieldsSchema,
  recordMessagePostedSchema,
} from '@antica/contracts';

import {
  MobileStoryShell,
  storyRecord,
} from '../../../../mobile.stories.fixtures';
import {
  findStoryElement,
  findStoryText,
} from '../../../../mobile.stories.helpers';

import { RecordMessagesContainer } from './RecordMessagesContainer';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import type { ReactElement } from 'react';

import type { RecordMessageDraft, RecordMessageEntry } from '@antica/contracts';

import type { StoryResponses } from '../../../../mobile.stories.fixtures';

import type { RecordMessagesContainerProps } from './RecordMessagesContainer';

const messagesPath = `/v1/records/${storyRecord.id}/messages`;
const draftId = '00000000-0000-4000-8000-000000000701';
const nameChangeId = '00000000-0000-4000-8000-000000000711';
const descriptionChangeId = '00000000-0000-4000-8000-000000000712';
const proposedChanges: RecordMessageDraft['proposedChanges'] = [
  {
    id: nameChangeId,
    field: 'name',
    before: storyRecord.name,
    proposed: 'Kangxi blue-and-white bowl',
    findingIds: [],
  },
  {
    id: descriptionChangeId,
    field: 'description',
    before: storyRecord.description,
    proposed:
      'Porcelain bowl with a hand-painted floral border and a lightly worn foot ring, consistent with the collector’s account.',
    findingIds: [],
  },
];

/**
 * builds a conversation entry for a story
 * @param id message identifier suffix
 * @param author who wrote the message
 * @param body message text
 * @param draft edit-draft state behind the message
 * @returns a conversation entry
 */
function storyEntry(
  id: number,
  author: RecordMessageEntry['author'],
  body: string,
  draft: Partial<RecordMessageDraft> = {},
): RecordMessageEntry {
  return {
    id: `00000000-0000-4000-8000-${String(800 + id).padStart(12, '0')}`,
    recordId: storyRecord.id,
    author,
    body,
    editDraftId: draftId,
    createdAt: '2026-10-17T08:00:00.000Z',
    draft: {
      status: 'ready',
      revision: 2,
      proposedChanges: [],
      appliedProposalIds: [],
      ...draft,
    },
  };
}

const failedQuestion = storyEntry(6, 'collector', 'Describe the rim', {
  status: 'failed',
});

/**
 * builds the stored draft the apply endpoint returns
 * @param appliedProposalIds proposals written to the record
 * @returns a contract-valid apply response
 */
function appliedResponse(appliedProposalIds: string[]): object {
  return editDraftAppliedSchema.parse({
    draft: {
      editDraftId: draftId,
      jobId: '00000000-0000-4000-8000-000000000702',
      revision: 3,
      status: 'partially_applied',
      snapshot: {
        recordId: storyRecord.id,
        versions: {
          recordRevision: storyRecord.recordRevision,
          analysisInputVersion: storyRecord.analysisInputVersion,
          evidenceVersion: storyRecord.evidenceVersion,
        },
        fields: recordFieldsSchema.strip().parse(storyRecord),
        transcriptionVersions: [],
        observationIds: [],
        sourceText: [],
        createdAt: storyRecord.createdAt,
      },
      result: null,
      invocation: null,
      appliedProposalIds,
      createdAt: storyRecord.createdAt,
      updatedAt: storyRecord.updatedAt,
    },
    record: storyRecord,
  });
}

const question = storyEntry(1, 'collector', '「康熙青花碗」名稱');
const answer = storyEntry(2, 'assistant', 'Here is a name you could use.', {
  proposedChanges,
});

/**
 * answers the record and a single conversation page
 * @param items entries of the page, oldest first
 * @returns story responses
 */
function threadResponses(items: RecordMessageEntry[]): StoryResponses {
  return {
    [`GET /v1/records/${storyRecord.id}`]: storyRecord,
    [`GET ${messagesPath}`]: { items, nextCursor: null },
  };
}

/**
 * renders the message area over the given responses
 * @param props container properties and story responses
 * @param props.responses HTTP responses of the story
 * @param props.locale interface locale
 * @returns the message area story surface
 */
function MessagesStory({
  responses,
  locale,
  ...args
}: Readonly<
  RecordMessagesContainerProps & {
    responses: StoryResponses;
    locale?: 'en' | 'zh-Hant';
  }
>): ReactElement {
  return (
    <MobileStoryShell responses={responses} locale={locale}>
      <RecordMessagesContainer {...args} />
    </MobileStoryShell>
  );
}

/**
 * renders a card whose fixture applies the confirmed proposals to the stored draft
 * @param args container properties
 * @returns stateful edit-card story surface
 */
function ApplyingCardStory(
  args: Readonly<RecordMessagesContainerProps>,
): ReactElement {
  const applied = useRef<string[]>([]);
  const responses = useMemo<StoryResponses>(
    () => ({
      [`GET /v1/records/${storyRecord.id}`]: storyRecord,
      [`GET ${messagesPath}`]: () => ({
        items: [
          question,
          {
            ...answer,
            draft: {
              ...answer.draft,
              status: applied.current.length
                ? 'partially_applied'
                : answer.draft.status,
              appliedProposalIds: applied.current,
            },
          },
        ],
        nextCursor: null,
      }),
      [`POST /v1/edit-drafts/${draftId}/apply`]: async (request) => {
        applied.current = editDraftApplySchema.parse(
          await request.json(),
        ).selectedProposalIds;

        return appliedResponse(applied.current);
      },
    }),
    [],
  );

  return <MessagesStory {...args} responses={responses} />;
}

const meta = {
  title: 'Mobile/Features/Collection/RecordMessagesContainer',
  component: RecordMessagesContainer,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: { recordId: storyRecord.id },
  argTypes: {
    recordId: {
      control: 'text',
      description: 'Collection record whose conversation is shown.',
    },
    messageId: {
      control: 'text',
      description:
        'Message to scroll to and mark, when opened from the change history.',
    },
  },
} satisfies Meta<typeof RecordMessagesContainer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty = {
  render: (args) => <MessagesStory {...args} responses={threadResponses([])} />,
  play: async ({ canvasElement }) => {
    await findStoryText(
      canvasElement,
      'Ask the assistant about this item by typing or speaking.',
    );
  },
} satisfies Story;

export const ThreadWithOlderMessages = {
  render: (args) => (
    <MessagesStory
      {...args}
      responses={{
        [`GET /v1/records/${storyRecord.id}`]: storyRecord,
        [`GET ${messagesPath}`]: (request) =>
          new URL(request.url).searchParams.get('cursor')
            ? {
                items: [storyEntry(3, 'collector', 'What is the glaze?')],
                nextCursor: null,
              }
            : {
                items: [storyEntry(4, 'assistant', 'A clear glaze over blue.')],
                nextCursor: 'older',
              },
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const earlier = await findStoryElement(
      canvasElement,
      '[data-testid="record-messages-load-earlier"]',
    );
    earlier.click();
    await findStoryText(canvasElement, 'What is the glaze?');
  },
} satisfies Story;

/** fixture numbers of the conversation opened from the change history */
const openedFixture = { question: 5, answer: 6 } as const;
const openedQuestion = storyEntry(
  openedFixture.question,
  'collector',
  'Tag it as a bowl.',
);

export const OpenedFromChangeHistory = {
  args: { messageId: openedQuestion.id },
  render: (args) => (
    <MessagesStory
      {...args}
      responses={{
        [`GET /v1/records/${storyRecord.id}`]: storyRecord,
        [`GET ${messagesPath}`]: {
          items: [
            openedQuestion,
            storyEntry(
              openedFixture.answer,
              'assistant',
              'Added the bowl tag.',
            ),
          ],
          nextCursor: null,
        },
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    await findStoryText(canvasElement, 'Opened from change history');
    await findStoryText(canvasElement, 'Tag it as a bowl.');
  },
} satisfies Story;

export const AssistantThinking = {
  render: (args) => (
    <MessagesStory
      {...args}
      responses={threadResponses([
        storyEntry(5, 'collector', 'How old is it?', { status: 'pending' }),
      ])}
    />
  ),
  play: async ({ canvasElement }) => {
    await findStoryText(canvasElement, 'The assistant is thinking…');
  },
} satisfies Story;

export const FailedReply = {
  render: (args) => (
    <MessagesStory
      {...args}
      responses={{
        ...threadResponses([failedQuestion]),
        [`POST ${messagesPath}`]: recordMessagePostedSchema.parse({
          editDraftId: draftId,
          jobId: '00000000-0000-4000-8000-000000000703',
          message: {
            id: '00000000-0000-4000-8000-000000000704',
            recordId: storyRecord.id,
            author: 'collector',
            body: failedQuestion.body,
            editDraftId: draftId,
            createdAt: failedQuestion.createdAt,
          },
        }),
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const again = await findStoryElement(
      canvasElement,
      `[data-testid="record-message-send-again-${failedQuestion.id}"]`,
    );
    again.click();
    await findStoryText(canvasElement, `POST ${messagesPath}`);
  },
} satisfies Story;

export const EditCardReady = {
  render: (args) => <ApplyingCardStory {...args} />,
  play: async ({ canvasElement }) => {
    const confirm = await findStoryElement(
      canvasElement,
      `[data-testid="record-message-card-confirm-${nameChangeId}"]`,
    );
    confirm.click();
    const apply = await findStoryElement(
      canvasElement,
      `[data-testid="record-message-card-apply-${draftId}"]`,
    );
    await findStoryText(canvasElement, 'Apply selected changes (1)');
    apply.click();
    await findStoryText(canvasElement, 'Some changes applied');
  },
} satisfies Story;

export const PartlyApplied = {
  render: (args) => (
    <MessagesStory
      {...args}
      responses={threadResponses([
        question,
        {
          ...answer,
          draft: {
            ...answer.draft,
            status: 'partially_applied',
            appliedProposalIds: [nameChangeId],
          },
        },
      ])}
    />
  ),
  play: async ({ canvasElement }) => {
    await findStoryText(canvasElement, 'Some changes applied');
  },
} satisfies Story;

export const AllApplied = {
  render: (args) => (
    <MessagesStory
      {...args}
      responses={threadResponses([
        question,
        {
          ...answer,
          draft: {
            ...answer.draft,
            status: 'applied',
            appliedProposalIds: [nameChangeId, descriptionChangeId],
          },
        },
      ])}
    />
  ),
  play: async ({ canvasElement }) => {
    await findStoryText(canvasElement, 'All changes applied');
  },
} satisfies Story;

export const StaleChangeInTraditionalChinese = {
  render: (args) => (
    <MessagesStory
      {...args}
      locale="zh-Hant"
      responses={{
        ...threadResponses([question, answer]),
        [`POST /v1/edit-drafts/${draftId}/apply`]: {
          storyError: {
            status: 409,
            code: 'REVISION_CONFLICT',
            message: 'Proposed field changed since draft',
          },
        },
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const confirm = await findStoryElement(
      canvasElement,
      `[data-testid="record-message-card-confirm-${descriptionChangeId}"]`,
    );
    confirm.click();
    await findStoryText(canvasElement, '套用所選變更 (1)');
    (
      await findStoryElement(
        canvasElement,
        `[data-testid="record-message-card-apply-${draftId}"]`,
      )
    ).click();
    await findStoryText(canvasElement, '已重新載入最新內容');
  },
} satisfies Story;
