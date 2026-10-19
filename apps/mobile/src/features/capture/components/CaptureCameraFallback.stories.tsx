import { MobileStoryShell } from '../../../mobile.stories.fixtures';
import {
  findStoryButton,
  findStoryElement,
  findStoryText,
} from '../../../mobile.stories.helpers';

import { expect, fn } from 'storybook/test';

import { CaptureCameraFallback } from './CaptureCameraFallback';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

const meta = {
  title: 'Mobile/Features/Capture/CaptureCameraFallback',
  component: CaptureCameraFallback,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Camera fallback (B02 errors): library import when camera access is denied or the camera cannot start',
      },
    },
  },
  render: (args) => (
    <MobileStoryShell responses={{}}>
      <CaptureCameraFallback {...args} />
    </MobileStoryShell>
  ),
  args: {
    reason: 'denied',
    onOpenSettings: fn(),
    onImport: fn(),
    onClose: fn(),
  },
  argTypes: {
    reason: {
      control: 'select',
      options: ['denied', 'unavailable'],
      description: 'Why the camera cannot be used',
    },
    onOpenSettings: { control: false },
    onImport: { control: false },
    onClose: { control: false },
  },
} satisfies Meta<typeof CaptureCameraFallback>;

export default meta;
type Story = StoryObj<typeof meta>;

/** camera access was refused: settings or import */
export const AccessDenied = {
  play: async ({ args, canvasElement }) => {
    await findStoryElement(canvasElement, '[role="alert"]');
    (await findStoryButton(canvasElement, 'Open system settings')).click();
    await expect(args.onOpenSettings).toHaveBeenCalledTimes(1);
    (await findStoryButton(canvasElement, 'Import file')).click();
    await expect(args.onImport).toHaveBeenCalledTimes(1);
  },
} satisfies Story;

/** the camera failed to start, in the mockup's language: import only */
export const UnavailableInTraditionalChinese = {
  render: (args) => (
    <MobileStoryShell locale="zh-Hant" responses={{}}>
      <CaptureCameraFallback {...args} />
    </MobileStoryShell>
  ),
  args: { reason: 'unavailable' },
  play: async ({ args, canvasElement }) => {
    await findStoryText(canvasElement, '目前無法使用相機。您可改為匯入照片。');
    await expect(
      canvasElement.querySelector('[aria-label="開啟系統設定"]'),
    ).toBeNull();
    (await findStoryButton(canvasElement, '關閉相機')).click();
    await expect(args.onClose).toHaveBeenCalledTimes(1);
  },
} satisfies Story;
