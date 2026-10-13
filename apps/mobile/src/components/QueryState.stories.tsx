import { useState } from 'react';
import { Text } from 'react-native';

import { LocaleProvider } from '../locale';

import { QueryState } from './QueryState';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import type { ReactElement } from 'react';

import type { QueryStateProps } from './QueryState';

/**
 * Demonstrates a retry by replacing the error with loaded content.
 * @param props Query state shown in the canvas.
 * @returns Interactive query state.
 */
function QueryStateDemo(
  props: Readonly<Omit<QueryStateProps, 'retry'>>,
): ReactElement {
  const [error, setError] = useState(props.error);

  return <QueryState {...props} error={error} retry={() => setError(null)} />;
}

const meta = {
  title: 'Mobile/Components/QueryState',
  component: QueryStateDemo,
  tags: ['autodocs'],
  decorators: [(story) => <LocaleProvider>{story()}</LocaleProvider>],
  args: {
    loading: false,
    error: null,
    children: <Text>Three saved references are ready.</Text>,
  },
  argTypes: {
    loading: { control: 'boolean' },
    error: { control: false },
    children: { control: false },
  },
} satisfies Meta<typeof QueryStateDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded = {
  render: (args) => <QueryStateDemo {...args} />,
} satisfies Story;

export const Empty = {
  args: { children: <Text>No collected references yet.</Text> },
  render: (args) => <QueryStateDemo {...args} />,
} satisfies Story;

export const Loading = {
  args: { loading: true },
  render: (args) => <QueryStateDemo {...args} />,
} satisfies Story;

export const Failed = {
  args: { error: new Error('References could not load.') },
  render: (args) => <QueryStateDemo {...args} />,
} satisfies Story;

export const FallbackError = {
  args: { error: new Error() },
  render: (args) => <QueryStateDemo {...args} />,
} satisfies Story;
