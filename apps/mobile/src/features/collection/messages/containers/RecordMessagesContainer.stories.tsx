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
import { expect } from 'storybook/test';

import { RecordMessagesContainer } from './RecordMessagesContainer';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import type { ReactElement } from 'react';

import type { RecordMessageDraft, RecordMessageEntry } from '@antica/contracts';

import type { Locale } from '../../../../i18n/resources';
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
      skippedProposalIds: [],
      ...draft,
    },
  };
}

const failedQuestion = storyEntry(6, 'collector', 'Describe the rim', {
  status: 'failed',
});

/** proposals the story fixture has settled so far */
interface SettledProposals {
  appliedProposalIds: string[];
  skippedProposalIds: string[];
}

/**
 * derives the draft status the server reports for the settled proposals
 * @param settled applied and skipped proposals
 * @param settled.appliedProposalIds proposals written to the record
 * @param settled.skippedProposalIds proposals recorded as not applied
 * @returns applied once every proposal is settled, partially applied once any is
 */
function settledStatus({
  appliedProposalIds,
  skippedProposalIds,
}: SettledProposals): RecordMessageDraft['status'] {
  const count = appliedProposalIds.length + skippedProposalIds.length;
  if (count === proposedChanges.length) {
    return 'applied';
  }

  return count ? 'partially_applied' : 'ready';
}

/**
 * builds the stored draft the apply endpoint returns
 * @param settled proposals written to the record and proposals skipped
 * @returns a contract-valid apply response
 */
function appliedResponse(settled: SettledProposals): object {
  return editDraftAppliedSchema.parse({
    draft: {
      editDraftId: draftId,
      jobId: '00000000-0000-4000-8000-000000000702',
      revision: 3,
      status: settledStatus(settled),
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
      ...settled,
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
    locale?: Locale;
  }
>): ReactElement {
  return (
    <MobileStoryShell responses={responses} locale={locale}>
      <RecordMessagesContainer {...args} />
    </MobileStoryShell>
  );
}

/**
 * renders a card whose fixture applies the confirmed proposals and skips the rejected ones on the stored draft
 * @param args container properties
 * @returns stateful edit-card story surface
 */
function ApplyingCardStory(
  args: Readonly<RecordMessagesContainerProps>,
): ReactElement {
  const settled = useRef<SettledProposals>({
    appliedProposalIds: [],
    skippedProposalIds: [],
  });
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
              ...settled.current,
              status: settledStatus(settled.current),
            },
          },
        ],
        nextCursor: null,
      }),
      [`POST /v1/edit-drafts/${draftId}/apply`]: async (request) => {
        const decided = {
          skippedProposalIds: [],
          ...editDraftApplySchema.parse(await request.json()),
        };
        settled.current = {
          appliedProposalIds: decided.selectedProposalIds,
          skippedProposalIds: decided.skippedProposalIds,
        };

        return appliedResponse(settled.current);
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
        {
          ...storyEntry(5, 'collector', 'How old is it?', {
            status: 'pending',
          }),
          // a fixed past time would turn the thinking state into the still-working one
          createdAt: new Date().toISOString(),
        },
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
    await findStoryText(
      canvasElement,
      'Sources must be reattached before sending again.',
    );
    await findStoryElement(
      canvasElement,
      '[data-testid="record-messages-related"]',
    );
    const input = await findStoryElement(
      canvasElement,
      '[data-testid="record-message-input"]',
    );
    await expect((input as HTMLTextAreaElement).value).toBe(
      failedQuestion.body,
    );
    await expect(
      canvasElement.querySelector(
        '[data-testid^="record-message-evidence-attachment-"]',
      ),
    ).toBeNull();
    await expect(canvasElement.textContent).not.toContain(
      `POST ${messagesPath}`,
    );
  },
} satisfies Story;

export const EditCardReady = {
  render: (args) => <ApplyingCardStory {...args} />,
  play: async ({ canvasElement }) => {
    const confirm = await findStoryElement(
      canvasElement,
      `[data-testid="record-message-card-confirm-name-${nameChangeId}"]`,
    );
    confirm.click();
    (
      await findStoryElement(
        canvasElement,
        `[data-testid="record-message-card-reject-description-${descriptionChangeId}"]`,
      )
    ).click();
    const apply = await findStoryElement(
      canvasElement,
      `[data-testid="record-message-card-apply-${draftId}"]`,
    );
    await findStoryText(canvasElement, 'Apply decisions (2)');
    apply.click();
    await findStoryText(canvasElement, 'All changes decided; some not applied');
    await findStoryElement(
      canvasElement,
      `[data-testid="record-message-card-applied-name-${nameChangeId}"]`,
    );
    await findStoryElement(
      canvasElement,
      `[data-testid="record-message-card-skipped-description-${descriptionChangeId}"]`,
    );
  },
} satisfies Story;

export const RejectOnly = {
  render: (args) => <ApplyingCardStory {...args} />,
  play: async ({ canvasElement }) => {
    const reject = await findStoryElement(
      canvasElement,
      `[data-testid="record-message-card-reject-description-${descriptionChangeId}"]`,
    );
    reject.click();
    await findStoryText(canvasElement, 'Apply decisions (1)');
    (
      await findStoryElement(
        canvasElement,
        `[data-testid="record-message-card-apply-${draftId}"]`,
      )
    ).click();
    await findStoryElement(
      canvasElement,
      `[data-testid="record-message-card-skipped-description-${descriptionChangeId}"]`,
    );
    await findStoryText(canvasElement, 'Some changes decided');
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

/** the name was applied and the description rejected, so every change is settled */
const resolvedAnswer: RecordMessageEntry = {
  ...answer,
  draft: {
    ...answer.draft,
    status: 'applied',
    appliedProposalIds: [nameChangeId],
    skippedProposalIds: [descriptionChangeId],
  },
};

export const ResolvedWithSkipped = {
  render: (args) => (
    <MessagesStory
      {...args}
      responses={threadResponses([question, resolvedAnswer])}
    />
  ),
  play: async ({ canvasElement }) => {
    await findStoryText(canvasElement, 'All changes decided; some not applied');
    await findStoryElement(
      canvasElement,
      `[data-testid="record-message-card-skipped-description-${descriptionChangeId}"]`,
    );
    await findStoryText(canvasElement, 'Not applied');
  },
} satisfies Story;

export const ResolvedWithSkippedInTraditionalChinese = {
  render: (args) => (
    <MessagesStory
      {...args}
      locale="zh-Hant"
      responses={threadResponses([question, resolvedAnswer])}
    />
  ),
  play: async ({ canvasElement }) => {
    await findStoryText(canvasElement, '所有變更均已處理，部分未套用');
    await findStoryText(canvasElement, '未套用');
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
      `[data-testid="record-message-card-confirm-description-${descriptionChangeId}"]`,
    );
    confirm.click();
    await findStoryText(canvasElement, '套用決定 (1)');
    (
      await findStoryElement(
        canvasElement,
        `[data-testid="record-message-card-apply-${draftId}"]`,
      )
    ).click();
    await findStoryText(canvasElement, '已重新載入最新內容');
  },
} satisfies Story;
