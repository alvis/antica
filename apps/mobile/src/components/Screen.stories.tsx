import { Text, View } from 'react-native';

import { Screen } from './Screen';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

const meta = {
  title: 'Mobile/Components/Screen',
  component: Screen,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    title: 'Collection',
    subtitle: 'Your private collection and research',
    scrollable: true,
    children: <Text>Saved objects and research appear here.</Text>,
  },
  argTypes: {
    scrollable: { control: 'boolean' },
    children: { control: false },
  },
} satisfies Meta<typeof Screen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Scrollable = {} satisfies Story;

export const FixedContent = {
  args: {
    title: 'Capture',
    subtitle: undefined,
    scrollable: false,
    children: (
      <View style={{ padding: 16 }}>
        <Text>
          Camera and recording controls stay in the fixed content area.
        </Text>
      </View>
    ),
  },
} satisfies Story;

export const WithoutHeading = {
  args: {
    title: undefined,
    subtitle: undefined,
    children: <Text>Content can supply its own heading.</Text>,
  },
} satisfies Story;
