import { useState } from 'react';
import { Text, View } from 'react-native';

import { savedPreferences } from '../../../i18n/preferences.spec.fixtures';
import { LocaleProvider } from '../../../providers/LocaleProvider';

import { SourcePagePreview } from './SourcePagePreview';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import type { ReactElement } from 'react';

import type { SourcePagePreviewProps } from './SourcePagePreview';

const imageUri =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAYAAACzzX7wAAAAEklEQVR4nGOQiPX5jw8z0F4BAEcWOAGdcyNWAAAAAElFTkSuQmCC';
const completeTurnQuarter = 3;

/**
 * shows the selected point without persisting or uploading a page
 * @param props preview state shown in the canvas.
 * @returns interactive page preview
 */
function PreviewDemo(
  props: Readonly<Omit<SourcePagePreviewProps, 'onCrop'>>,
): ReactElement {
  const [selection, setSelection] = useState('No point selected');

  return (
    <View style={{ maxWidth: 320, padding: 16 }}>
      <SourcePagePreview
        {...props}
        onCrop={(x, y) =>
          setSelection(`Selected ${x.toFixed(2)}, ${y.toFixed(2)}`)
        }
      />
      <Text>{selection}</Text>
    </View>
  );
}

const meta = {
  title: 'Mobile/Features/Knowledge/SourcePagePreview',
  component: PreviewDemo,
  tags: ['autodocs'],
  decorators: [
    (story) => (
      <LocaleProvider preferences={savedPreferences('en')}>
        {story()}
      </LocaleProvider>
    ),
  ],
  args: {
    uri: imageUri,
    name: 'Book page',
    width: 8,
    height: 4,
    displayWidth: 260,
    rotationQuarterTurns: 0,
    crop: null,
  },
  argTypes: {
    width: { control: 'number' },
    height: { control: 'number' },
    displayWidth: { control: 'number' },
    rotationQuarterTurns: {
      control: 'select',
      options: [0, 1, 2, completeTurnQuarter],
    },
    crop: { control: false },
  },
} satisfies Meta<typeof PreviewDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OriginalAndPrepared = {
  render: (args) => <PreviewDemo {...args} />,
} satisfies Story;

export const CroppedAndRotated = {
  args: {
    crop: { kind: 'rect', x: 0.25, y: 0, width: 0.5, height: 1 },
    rotationQuarterTurns: 1,
  },
  render: (args) => <PreviewDemo {...args} />,
} satisfies Story;

export const FailedPreparation = {
  args: { crop: { kind: 'rect', x: 0, y: 0, width: 0, height: 0 } },
  render: (args) => <PreviewDemo {...args} />,
} satisfies Story;
