import { useMemo, useRef } from 'react';

import { recordDetailSchema, recordPatchSchema } from '@antica/contracts';

import { MobileStoryShell, storyRecord } from '../../mobile.stories.fixtures';
import {
  findStoryButton,
  findStoryElement,
  findStoryText,
  setStoryInputValue,
} from '../../mobile.stories.helpers';

import { RecordContainer } from './RecordContainer';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import type { ReactElement } from 'react';

import type { StoryResponses } from '../../mobile.stories.fixtures';

import type { RecordContainerProps } from './RecordContainer';

const emptyPage = { items: [], nextCursor: null };
const readyResponses = {
  [`GET /v1/records/${storyRecord.id}`]: storyRecord,
  [`GET /v1/records/${storyRecord.id}/observations`]: emptyPage,
  [`GET /v1/records/${storyRecord.id}/references`]: emptyPage,
  [`PATCH /v1/records/${storyRecord.id}`]: {
    ...storyRecord,
    name: 'Blue-and-white bowl, edited',
    recordRevision: storyRecord.recordRevision + 1,
  },
};

/**
 * Renders a record story whose fixture persists submitted edits.
 * @param args Record container properties.
 * @returns Stateful record story surface.
 */
function SavedRecordStory(args: Readonly<RecordContainerProps>): ReactElement {
  const currentRecord = useRef(storyRecord);
  const responses = useMemo<StoryResponses>(
    () => ({
      [`GET /v1/records/${storyRecord.id}`]: () => currentRecord.current,
      [`GET /v1/records/${storyRecord.id}/observations`]: emptyPage,
      [`GET /v1/records/${storyRecord.id}/references`]: emptyPage,
      [`PATCH /v1/records/${storyRecord.id}`]: async (request) => {
        const patch = recordPatchSchema.parse(await request.json());
        currentRecord.current = recordDetailSchema.parse({
          ...currentRecord.current,
          ...patch.fields,
          recordRevision: currentRecord.current.recordRevision + 1,
        });

        return currentRecord.current;
      },
    }),
    [],
  );

  return (
    <MobileStoryShell responses={responses}>
      <RecordContainer {...args} />
    </MobileStoryShell>
  );
}

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

export const SavedRecord = {
  render: (args) => <SavedRecordStory {...args} />,
  play: async ({ canvasElement }) => {
    const edit = await findStoryButton(canvasElement, 'Edit');
    edit.click();
    const name = await findStoryElement(
      canvasElement,
      'input[aria-label="Name"]',
    );
    name.focus();
    setStoryInputValue(name, 'Blue-and-white bowl, edited');
    const save = await findStoryButton(canvasElement, 'Save');
    save.click();
    await findStoryText(canvasElement, `PATCH /v1/records/${storyRecord.id}`);
    await findStoryText(canvasElement, 'Blue-and-white bowl, edited');
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
