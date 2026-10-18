import { MobileStoryShell } from '../../../mobile.stories.fixtures';
import {
  findStoryButton,
  findStoryElement,
  findStoryText,
} from '../../../mobile.stories.helpers';

import { expect, fn } from 'storybook/test';

import { CaptureSaveStep } from './CaptureSaveStep';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import type { LocalMedia } from '../../../adapters/media-upload';

/**
 * builds a draft photo for a story
 * @param index position in the save list, from 1
 * @param overrides fields that differ from a local object photo
 * @returns the draft file
 */
function storyFile(
  index: number,
  overrides: Partial<LocalMedia> = {},
): LocalMedia {
  return {
    id: `file-${index}`,
    uri: `file:///antica-${index}.jpg`,
    name: `antica-${index}.jpg`,
    mimeType: 'image/jpeg',
    kind: 'photo',
    purpose: 'object',
    componentLabel: '',
    state: 'local',
    assetId: null,
    ...overrides,
  };
}

const meta = {
  title: 'Mobile/Features/Capture/CaptureSaveStep',
  component: CaptureSaveStep,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Save step: each file with its upload state, a retry for a failed file, and a retry for all once two or more failed',
      },
    },
  },
  render: (args) => (
    <MobileStoryShell responses={{}}>
      <CaptureSaveStep {...args} />
    </MobileStoryShell>
  ),
  args: {
    files: [storyFile(1), storyFile(2)],
    fileErrors: {},
    busy: false,
    onSave: fn(),
    onRetry: fn(),
    onRetryAll: fn(),
  },
  argTypes: {
    files: { control: false },
    fileErrors: { control: false },
    busy: {
      control: 'boolean',
      description: 'A save or retry is running',
    },
    onSave: { control: false },
    onRetry: { control: false },
    onRetryAll: { control: false },
  },
} satisfies Meta<typeof CaptureSaveStep>;

export default meta;
type Story = StoryObj<typeof meta>;

/** one photo uploaded, one sending its parts, announced as a progress bar */
export const Uploading = {
  args: {
    busy: true,
    files: [
      storyFile(1, { state: 'uploaded', assetId: 'asset-1' }),
      storyFile(2, { state: 'uploading', progress: { uploaded: 3, total: 5 } }),
    ],
  },
  play: async ({ canvasElement }) => {
    await findStoryText(canvasElement, 'antica-1.jpg: Uploaded');
    await findStoryElement(
      canvasElement,
      '[data-testid="capture-file-state-2"][role="progressbar"][aria-valuenow="3"]',
    );
    await findStoryText(canvasElement, 'antica-2.jpg: Uploading 3/5');
    await expect(
      canvasElement.querySelector('[data-testid="capture-retry-all"]'),
    ).toBeNull();
  },
} satisfies Story;

/** a single failed photo shows why and offers its own retry, never calling it saved */
export const OneFailed = {
  args: {
    files: [
      storyFile(1, { state: 'uploaded', assetId: 'asset-1' }),
      storyFile(2, { state: 'failed', errorCode: 'NETWORK' }),
    ],
    fileErrors: { 'file-2': 'No connection. The file is kept on this device.' },
  },
  play: async ({ args, canvasElement }) => {
    await findStoryText(
      canvasElement,
      'antica-2.jpg: Not uploaded — No connection. The file is kept on this device.',
    );
    (await findStoryButton(canvasElement, 'Retry antica-2.jpg')).click();
    await expect(args.onRetry).toHaveBeenCalledWith('file-2');
    await expect(
      canvasElement.querySelector('[data-testid="capture-retry-all"]'),
    ).toBeNull();
  },
} satisfies Story;

/** two failed photos, in the collector's language, offer a retry for both */
export const SeveralFailedInTraditionalChinese = {
  render: (args) => (
    <MobileStoryShell locale="zh-Hant" responses={{}}>
      <CaptureSaveStep {...args} />
    </MobileStoryShell>
  ),
  args: {
    files: [
      storyFile(1, { state: 'failed', errorCode: 'NETWORK' }),
      storyFile(2, { state: 'failed', errorCode: 'NETWORK' }),
    ],
  },
  play: async ({ args, canvasElement }) => {
    await findStoryText(canvasElement, 'antica-1.jpg: 未上傳');
    (await findStoryButton(canvasElement, '重試 2 個未上傳的檔案')).click();
    await expect(args.onRetryAll).toHaveBeenCalled();
  },
} satisfies Story;
