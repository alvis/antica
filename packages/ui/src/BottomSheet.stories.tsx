import { userEvent, within } from '@storybook/testing-library';

import { useState } from 'react';
import { Text } from 'react-native';

import { expect, fn } from 'storybook/test';

import { ActionButton } from './ActionButton.js';
import { BottomSheet } from './BottomSheet.js';
import { Card } from './Card.js';

import { styles } from './theme.js';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import type { FC } from 'react';

/**
 * opens the sheet from a button so opening and closing are both observable
 * @param props story properties
 * @param props.onClose spy for each close request
 * @returns the trigger and the sheet
 */
const SheetDemo: FC<{ onClose: () => void }> = ({ onClose }) => {
  const [visible, setVisible] = useState(false);

  return (
    <>
      <ActionButton label="打開面板" onPress={() => setVisible(true)} />
      <BottomSheet
        visible={visible}
        title="問助理"
        closeLabel="關閉"
        onClose={() => {
          onClose();
          setVisible(false);
        }}>
        <Card>
          <Text style={styles.label}>關於這件藏品</Text>
          <Text style={styles.heading}>青釉開片盤</Text>
        </Card>
      </BottomSheet>
    </>
  );
};

const meta = {
  title: 'Components/BottomSheet',
  component: SheetDemo,
  tags: ['autodocs'],
  args: { onClose: fn<() => void>() },
} satisfies Meta<typeof SheetDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OpenAndClose: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: '打開面板' }),
    );
    // the modal renders into a portal outside the story canvas
    const page = within(canvasElement.ownerDocument.body);
    await expect(page.getByText('青釉開片盤')).toBeVisible();

    await userEvent.click(page.getByRole('button', { name: '關閉' }));

    await expect(args.onClose).toHaveBeenCalledTimes(1);
    await expect(page.queryByText('青釉開片盤')).toBeNull();
  },
};
