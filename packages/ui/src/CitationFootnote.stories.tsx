import { userEvent, within } from '@storybook/testing-library';

import { Text, View } from 'react-native';

import { expect, fn } from 'storybook/test';

import { CitationFootnote } from './CitationFootnote.js';

import { styles } from './theme.js';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import type { CitationFootnoteProps } from './CitationFootnote.js';

const meta = {
  title: 'Components/CitationFootnote',
  component: CitationFootnote,
  tags: ['autodocs'],
  args: {
    number: 1,
    label: '克里夫蘭藝術博物館 · 汝窯的胎、釉與支釘痕',
    onPress: fn<CitationFootnoteProps['onPress']>(),
  },
  render: (args) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
      <Text style={[styles.body, { flexShrink: 1 }]}>
        館方描述汝窯底部有芝麻粒般細小的支釘痕。
      </Text>
      <CitationFootnote {...args} />
    </View>
  ),
} satisfies Meta<typeof CitationFootnote>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OpensSource: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('link', { name: /克里夫蘭/ }),
    );

    await expect(args.onPress).toHaveBeenCalledTimes(1);
  },
};

/** the footnote flowing after a quote's last character, as 今日知識 shows it */
export const InlineAfterQuote: Story = {
  args: {
    number: 4,
    inline: true,
    onPress: fn<CitationFootnoteProps['onPress']>(),
  },
  render: (args) => (
    <View style={{ padding: 16 }}>
      <Text style={styles.body}>
        「此壺器形為本土發展，似由附有小雞首的壺形器演變而來。」
        <CitationFootnote {...args} />
      </Text>
    </View>
  ),
  play: async ({ args, canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('link', { name: /^4 克里夫蘭/ }),
    );

    await expect(args.onPress).toHaveBeenCalledTimes(1);
  },
};
