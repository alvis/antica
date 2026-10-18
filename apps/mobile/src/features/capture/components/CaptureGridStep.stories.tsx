import { useState } from 'react';

import { MobileStoryShell } from '../../../mobile.stories.fixtures';
import {
  findStoryButton,
  findStoryElement,
  findStoryText,
} from '../../../mobile.stories.helpers';

import { expect, fn } from 'storybook/test';

import { labelFile, toggleSelected, wholeRecord } from '../capture-grid';

import { CaptureGridStep } from './CaptureGridStep';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import type { ComponentProps, ReactElement } from 'react';

import type { LocalMedia } from '../../../adapters/media-upload';

/** a celadon-coloured square standing in for a photo */
const storyPhoto =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="%2392A89A"/></svg>';

/**
 * builds a local draft file for a story
 * @param index position in capture order, from 1
 * @param overrides fields that differ from a local object photo
 * @returns the draft file
 */
function storyFile(
  index: number,
  overrides: Partial<LocalMedia> = {},
): LocalMedia {
  return {
    id: `file-${index}`,
    uri: storyPhoto,
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

/** the mockup's six photos of a pair of vases, as label and shot type; the first two show the whole pair */
const vaseShots = [
  [wholeRecord, 'set'],
  [wholeRecord, 'set'],
  ['左瓶', 'base'],
  ['右瓶', 'base'],
  ['左瓶', 'detail'],
  ['右瓶', 'detail'],
] as const;
const vasePhotos = vaseShots.map(([componentLabel, shotType], index) =>
  storyFile(index + 1, { componentLabel, shotType }),
);

/** a photo, a video with a still, and a video whose still could not be made */
const mixedMedia = [
  storyFile(1, { componentLabel: 'Complete set' }),
  ...['file:///turn.mp4', 'file:///broken.mp4'].map((uri, index) =>
    storyFile(index + 2, { kind: 'video', mimeType: 'video/mp4', uri }),
  ),
];

/**
 * keeps the grid's selection and labels in story state, as the capture container does
 * @param props grid properties with the starting files
 * @returns the interactive grid
 */
function StatefulGrid(
  props: Readonly<ComponentProps<typeof CaptureGridStep>>,
): ReactElement {
  const [files, setFiles] = useState(props.files);

  return (
    <CaptureGridStep
      {...props}
      files={files}
      onToggle={(fileId) => {
        props.onToggle(fileId);
        setFiles((current) => toggleSelected(current, fileId));
      }}
      onLabel={(fileId, label) => {
        props.onLabel(fileId, label);
        setFiles((current) => labelFile(current, fileId, label));
      }}
    />
  );
}

const meta = {
  title: 'Mobile/Features/Capture/CaptureGridStep',
  component: CaptureGridStep,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Image grid (B03): two columns of photos and videos to keep or leave out, labelled by component for a set',
      },
    },
  },
  render: (args) => (
    <MobileStoryShell responses={{}}>
      <StatefulGrid {...args} />
    </MobileStoryShell>
  ),
  args: {
    kind: 'set',
    recordName: 'Pair of celadon vases',
    recordCode: 'AC-0001',
    files: vasePhotos.map((file) => ({ ...file, componentLabel: '' })),
    componentLabels: [],
    thumbnails: {},
    onToggle: fn(),
    onLabel: fn(),
    onRetry: fn(),
    onAddPhoto: fn(),
    onAddVideo: fn(),
    onBack: fn(),
    onNext: fn(),
  },
  argTypes: {
    kind: {
      control: 'select',
      options: ['single', 'set'],
      description: 'Only a set labels its components',
    },
    recordName: { control: 'text', description: 'Record name' },
    recordCode: { control: 'text', description: 'Record code' },
    files: { control: false },
    componentLabels: { control: false },
    thumbnails: { control: false },
    onToggle: { control: false },
    onLabel: { control: false },
    onRetry: { control: false },
    busy: {
      control: 'boolean',
      description: 'Another upload runs, so retrying waits',
    },
    onAddPhoto: { control: false },
    onAddVideo: { control: false },
    onBack: { control: false },
    onNext: { control: false },
  },
} satisfies Meta<typeof CaptureGridStep>;

export default meta;
type Story = StoryObj<typeof meta>;

/** B03 as in the mockup: six labelled photos of a pair, all selected */
export const LabelledSetInTraditionalChinese = {
  render: (args) => (
    <MobileStoryShell locale="zh-Hant" responses={{}}>
      <StatefulGrid {...args} />
    </MobileStoryShell>
  ),
  args: { recordName: '青釉瓶一對', files: vasePhotos },
  play: async ({ args, canvasElement }) => {
    await findStoryText(canvasElement, '整理影像');
    await findStoryText(canvasElement, '已選 6 張');
    await findStoryElement(canvasElement, '[aria-label="照片 1：整套"]');
    await findStoryElement(canvasElement, '[aria-label="照片 3：左瓶"]');
    (await findStoryButton(canvasElement, '下一步')).click();
    await expect(args.onNext).toHaveBeenCalledTimes(1);
  },
} satisfies Story;

/** deselecting a photo leaves it in the grid but out of the count */
export const DeselectOnePhoto = {
  play: async ({ args, canvasElement }) => {
    (
      await findStoryElement(
        canvasElement,
        '[role="checkbox"][aria-label="Save Photo 2: No label"]',
      )
    ).click();
    await findStoryText(canvasElement, '5 selected');
    await expect(args.onToggle).toHaveBeenCalledWith('file-2');
  },
} satisfies Story;

/** the label picker offers the whole record, the labels already used, and a new label */
export const PickLabel = {
  args: {
    componentLabels: ['Lid'],
    files: [storyFile(1, { shotType: 'base' }), storyFile(2)],
  },
  play: async ({ args, canvasElement }) => {
    const page = canvasElement.ownerDocument.body;
    (
      await findStoryButton(
        canvasElement,
        'Change the component label of Photo 1',
      )
    ).click();
    await findStoryText(page, 'Labels used in this item');
    await expect(
      page.querySelector('[role="radio"][aria-label="Base"]'),
    ).toBeNull();
    (
      await findStoryElement(page, '[role="radio"][aria-label="Complete set"]')
    ).click();
    await expect(args.onLabel).toHaveBeenCalledWith('file-1', wholeRecord);
    await findStoryElement(
      canvasElement,
      '[aria-label="Photo 1: Complete set"]',
    );
  },
} satisfies Story;

/** a video with a still beside one whose still could not be made */
export const VideosWithAndWithoutStills = {
  args: {
    files: mixedMedia,
    thumbnails: { 'file-2': storyPhoto, 'file-3': null },
  },
  play: async ({ args, canvasElement }) => {
    await findStoryElement(canvasElement, '[aria-label="Video 2: No label"]');
    await findStoryElement(
      canvasElement,
      '[data-testid="capture-grid-video-icon-3"]',
    );
    (await findStoryButton(canvasElement, 'Add video')).click();
    await expect(args.onAddVideo).toHaveBeenCalledTimes(1);
  },
} satisfies Story;

/** a single item shows no component labels */
export const SingleItem = {
  args: { kind: 'single', files: [storyFile(1), storyFile(2)] },
  play: async ({ args, canvasElement }) => {
    await findStoryElement(canvasElement, '[aria-label="Photo 2"]');
    await expect(
      canvasElement.querySelector('[data-testid="capture-grid-label-1"]'),
    ).toBeNull();
    (await findStoryButton(canvasElement, 'Add photo')).click();
    await expect(args.onAddPhoto).toHaveBeenCalledTimes(1);
    (await findStoryButton(canvasElement, 'Back')).click();
    await expect(args.onBack).toHaveBeenCalledTimes(1);
  },
} satisfies Story;

/** after a save attempt each tile names its upload state, and a failed photo offers a retry */
export const UploadStates = {
  args: {
    kind: 'single',
    files: (
      [
        { state: 'uploaded', assetId: 'asset-1' },
        { state: 'uploading', progress: { uploaded: 2, total: 5 } },
        { state: 'failed', errorCode: 'NETWORK' },
      ] satisfies Array<Partial<LocalMedia>>
    ).map((overrides, index) => storyFile(index + 1, overrides)),
  },
  play: async ({ args, canvasElement }) => {
    await findStoryElement(
      canvasElement,
      '[role="progressbar"][aria-valuenow="2"][aria-valuemax="5"]',
    );
    await findStoryText(canvasElement, 'Uploading 2/5');
    await findStoryText(canvasElement, 'Not uploaded');
    (await findStoryButton(canvasElement, 'Retry Photo 3')).click();
    await expect(args.onRetry).toHaveBeenCalledWith('file-3');
  },
} satisfies Story;
