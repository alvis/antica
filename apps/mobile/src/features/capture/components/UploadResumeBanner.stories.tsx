import { useState } from 'react';

import { MobileStoryShell } from '../../../mobile.stories.fixtures';
import {
  findStoryButton,
  findStoryElement,
  findStoryText,
} from '../../../mobile.stories.helpers';

import { expect, fn } from 'storybook/test';

import { UploadResumeBanner } from './UploadResumeBanner';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import type { ComponentProps, ReactElement } from 'react';

/**
 * keeps the discard confirmation in story state, as the resume container does
 * @param props banner properties with the starting confirmation
 * @returns the interactive banner
 */
function StatefulBanner(
  props: Readonly<ComponentProps<typeof UploadResumeBanner>>,
): ReactElement {
  const [confirming, setConfirming] = useState(props.confirming);

  return (
    <UploadResumeBanner
      {...props}
      confirming={confirming}
      onDiscard={() => {
        props.onDiscard();
        setConfirming(true);
      }}
      onKeep={() => {
        props.onKeep();
        setConfirming(false);
      }}
    />
  );
}

const meta = {
  title: 'Mobile/Features/Capture/UploadResumeBanner',
  component: UploadResumeBanner,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Resume prompt after a restart: files that never finished uploading wait for the collector to resume or discard them',
      },
    },
  },
  render: (args) => (
    <MobileStoryShell responses={{}}>
      <StatefulBanner {...args} />
    </MobileStoryShell>
  ),
  args: {
    recordLabel: 'Celadon bowl',
    count: 3,
    confirming: false,
    onResume: fn(),
    onDiscard: fn(),
    onConfirmDiscard: fn(),
    onKeep: fn(),
  },
  argTypes: {
    recordLabel: { control: 'text', description: 'Record name or code' },
    count: { control: 'number', description: 'Files still to upload' },
    confirming: {
      control: 'boolean',
      description: 'Asks to confirm discarding the local copies',
    },
    onResume: { control: false },
    onDiscard: { control: false },
    onConfirmDiscard: { control: false },
    onKeep: { control: false },
  },
} satisfies Meta<typeof UploadResumeBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** after a restart nothing uploads until the collector resumes */
export const ResumeAfterRestart = {
  play: async ({ args, canvasElement }) => {
    await findStoryElement(
      canvasElement,
      '[data-testid="upload-resume-banner"]',
    );
    await findStoryText(
      canvasElement,
      '3 files from Celadon bowl have not finished uploading',
    );
    (await findStoryButton(canvasElement, 'Resume upload')).click();
    await expect(args.onResume).toHaveBeenCalled();
  },
} satisfies Story;

/** discarding asks once more, and keeping returns to the prompt */
export const ConfirmDiscard = {
  args: { count: 1 },
  play: async ({ args, canvasElement }) => {
    (await findStoryButton(canvasElement, 'Discard')).click();
    await findStoryText(
      canvasElement,
      'Discard 1 file? Its copy on this device is deleted.',
    );
    (await findStoryButton(canvasElement, 'Keep')).click();
    await expect(args.onKeep).toHaveBeenCalled();
    (await findStoryButton(canvasElement, 'Discard')).click();
    (await findStoryButton(canvasElement, 'Discard files')).click();
    await expect(args.onConfirmDiscard).toHaveBeenCalled();
  },
} satisfies Story;

/** the prompt in the mockup's language */
export const ResumeInTraditionalChinese = {
  render: (args) => (
    <MobileStoryShell locale="zh-Hant" responses={{}}>
      <StatefulBanner {...args} />
    </MobileStoryShell>
  ),
  args: { recordLabel: '青釉碗', count: 2 },
  play: async ({ args, canvasElement }) => {
    await findStoryText(canvasElement, '「青釉碗」有 2 個檔案尚未完成上傳');
    (await findStoryButton(canvasElement, '繼續上傳')).click();
    await expect(args.onResume).toHaveBeenCalled();
  },
} satisfies Story;
