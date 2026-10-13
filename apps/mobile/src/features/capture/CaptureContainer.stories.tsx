import { MobileStoryShell, storyRecord } from '../../mobile.stories.fixtures';
import { findStoryButton, findStoryText } from '../../mobile.stories.helpers';

import { CaptureContainer } from './CaptureContainer';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

const readyResponses = {
  'GET /v1/locations': [
    { id: '00000000-0000-4000-8000-000000000044', label: 'Study cabinet' },
  ],
  'POST /v1/records': storyRecord,
};

const meta = {
  title: 'Mobile/Features/Capture/CaptureContainer',
  component: CaptureContainer,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof CaptureContainer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ChooseCaptureMethod = {
  render: () => (
    <MobileStoryShell responses={readyResponses}>
      <CaptureContainer />
    </MobileStoryShell>
  ),
  play: async ({ canvasElement }) => {
    const singleItem = await findStoryButton(canvasElement, 'Single item');
    singleItem.click();
    await findStoryText(canvasElement, '2 / 6');
    await findStoryText(canvasElement, 'POST /v1/records');
  },
} satisfies Story;

export const CreatingDraft = {
  render: () => (
    <MobileStoryShell responses={readyResponses} delayMs={60_000}>
      <CaptureContainer />
    </MobileStoryShell>
  ),
  play: async ({ canvasElement }) => {
    const singleItem = await findStoryButton(canvasElement, 'Single item');
    singleItem.click();
    await findStoryText(canvasElement, 'POST /v1/records');
  },
} satisfies Story;

export const DraftFailureInTraditionalChinese = {
  render: () => (
    <MobileStoryShell
      locale="zh-Hant"
      responses={{
        'GET /v1/locations': [],
        'POST /v1/records': {
          storyError: {
            status: 503,
            code: 'DRAFT_UNAVAILABLE',
            message: '目前無法建立藏品草稿。',
          },
        },
      }}>
      <CaptureContainer />
    </MobileStoryShell>
  ),
  play: async ({ canvasElement }) => {
    const singleItem = await findStoryButton(canvasElement, '單件');
    singleItem.click();
    await findStoryText(canvasElement, '目前無法建立藏品草稿。');
  },
} satisfies Story;
