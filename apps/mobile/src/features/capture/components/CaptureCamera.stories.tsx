import { View } from 'react-native';

import { MobileStoryShell } from '../../../mobile.stories.fixtures';
import {
  findStoryButton,
  findStoryElement,
  findStoryText,
} from '../../../mobile.stories.helpers';

import { expect, fn } from 'storybook/test';

import { CaptureCamera } from './CaptureCamera';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

/** a celadon-coloured square standing in for a photo */
const storyPhoto =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="%2392A89A"/></svg>';

const meta = {
  title: 'Mobile/Features/Capture/CaptureCamera',
  component: CaptureCamera,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'In-app multi-shot camera (B02): shot-type chips, a last-shot thumbnail that opens the grid, the shutter, the camera switch and the flash',
      },
    },
  },
  render: (args) => (
    <MobileStoryShell responses={{}}>
      <View style={{ height: 720 }}>
        <CaptureCamera {...args} />
      </View>
    </MobileStoryShell>
  ),
  args: {
    recordLabel: 'New item · AC-0001',
    viewfinder: <View style={{ flex: 1, backgroundColor: '#C9C2B2' }} />,
    shotType: 'set',
    onShotType: fn(),
    flash: false,
    onFlash: fn(),
    lastShotUri: null,
    shotCount: 0,
    busy: false,
    failed: false,
    onShutter: fn(),
    onReview: fn(),
    onSwitch: fn(),
    onClose: fn(),
  },
  argTypes: {
    recordLabel: { control: 'text', description: 'Record name and code' },
    shotType: {
      control: 'select',
      options: ['set', 'base', 'mark', 'detail'],
      description: 'Selected shot type',
    },
    flash: { control: 'boolean', description: 'The flash fires' },
    lastShotUri: { control: 'text', description: 'Last photo of the session' },
    shotCount: { control: 'number', description: 'Photos taken so far' },
    busy: { control: 'boolean', description: 'A photo is being taken' },
    failed: { control: 'boolean', description: 'The last photo failed' },
    viewfinder: { control: false },
    onShotType: { control: false },
    onFlash: { control: false },
    onShutter: { control: false },
    onReview: { control: false },
    onSwitch: { control: false },
    onClose: { control: false },
  },
} satisfies Meta<typeof CaptureCamera>;

export default meta;
type Story = StoryObj<typeof meta>;

/** B02 before the first shot: nothing to review yet */
export const ReadyToShoot = {
  play: async ({ args, canvasElement }) => {
    await findStoryElement(
      canvasElement,
      '[role="button"][aria-label="Review 0 photos taken"][aria-disabled="true"]',
    );
    (await findStoryButton(canvasElement, 'Take photo')).click();
    await expect(args.onShutter).toHaveBeenCalledTimes(1);
    (
      await findStoryElement(canvasElement, '[role="radio"][aria-label="Base"]')
    ).click();
    await expect(args.onShotType).toHaveBeenCalledWith('base');
  },
} satisfies Story;

/** B02 in the mockup's language, after shooting the complete set */
export const AfterShotsInTraditionalChinese = {
  render: (args) => (
    <MobileStoryShell locale="zh-Hant" responses={{}}>
      <View style={{ height: 720 }}>
        <CaptureCamera {...args} />
      </View>
    </MobileStoryShell>
  ),
  args: {
    recordLabel: '新藏品・AC-0001',
    lastShotUri: storyPhoto,
    shotCount: 2,
  },
  play: async ({ args, canvasElement }) => {
    await findStoryText(canvasElement, '拍攝藏品');
    await findStoryText(canvasElement, '先拍整套，再補充細節。');
    await findStoryText(canvasElement, '已加入第 2 張照片');
    (await findStoryButton(canvasElement, '查看已拍的 2 張照片')).click();
    await expect(args.onReview).toHaveBeenCalledTimes(1);
  },
} satisfies Story;

/** detail shots with the flash on and the shutter waiting for the last photo */
export const ShootingDetailWithFlash = {
  args: { shotType: 'detail', flash: true, busy: true, shotCount: 4 },
  play: async ({ args, canvasElement }) => {
    await findStoryElement(
      canvasElement,
      '[role="switch"][aria-label="Flash"]',
    );
    await findStoryElement(
      canvasElement,
      '[role="button"][aria-label="Take photo"][aria-disabled="true"]',
    );
    (await findStoryButton(canvasElement, 'Switch camera')).click();
    await expect(args.onSwitch).toHaveBeenCalledTimes(1);
    (await findStoryButton(canvasElement, 'Close camera')).click();
    await expect(args.onClose).toHaveBeenCalledTimes(1);
  },
} satisfies Story;

/** a shot that failed is reported without leaving the camera */
export const ShotFailed = {
  args: { failed: true },
  play: async ({ canvasElement }) => {
    await findStoryElement(canvasElement, '[role="alert"]');
    await findStoryText(
      canvasElement,
      'The photo could not be taken. Try again.',
    );
  },
} satisfies Story;
