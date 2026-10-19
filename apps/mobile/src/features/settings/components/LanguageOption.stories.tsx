import { findStoryElement } from '../../../mobile.stories.helpers';
import { expect, fn } from 'storybook/test';

import { LanguageOption } from './LanguageOption';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

const meta = {
  title: 'Mobile/Features/Settings/LanguageOption',
  component: LanguageOption,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'One interface-language radio choice, named in its own writing system',
      },
    },
  },
  args: {
    label: 'English',
    checked: false,
    onPress: fn(),
    testID: 'language-option-en',
  },
  argTypes: {
    label: { control: 'text', description: 'Language name or Follow system' },
    detail: { control: 'text', description: 'Optional secondary text' },
    checked: { control: 'boolean', description: 'Selected draft choice' },
    disabled: { control: 'boolean', description: 'Locked while saving' },
    onPress: { control: false, description: 'Selects this choice' },
    testID: { control: 'text', description: 'Automation identifier' },
  },
} satisfies Meta<typeof LanguageOption>;

export default meta;
type Story = StoryObj<typeof meta>;

/** an unselected choice selects itself when pressed */
export const Unselected = {
  play: async ({ args, canvasElement }) => {
    (
      await findStoryElement(
        canvasElement,
        '[role="radio"][aria-label="English"][aria-checked="false"]',
      )
    ).click();
    await expect(args.onPress).toHaveBeenCalledTimes(1);
  },
} satisfies Story;

/** the default choice, selected, with its secondary text */
export const SelectedDefault = {
  args: { label: '繁體中文', detail: '預設', checked: true },
  play: async ({ canvasElement }) => {
    await findStoryElement(
      canvasElement,
      '[role="radio"][aria-label="繁體中文, 預設"][aria-checked="true"]',
    );
  },
} satisfies Story;

/** a choice locked while a save is running */
export const Disabled = {
  args: { label: 'English', disabled: true, onPress: fn() },
  play: async ({ args, canvasElement }) => {
    (
      await findStoryElement(
        canvasElement,
        '[role="radio"][aria-label="English"][aria-disabled="true"]',
      )
    ).click();
    await expect(args.onPress).not.toHaveBeenCalled();
  },
} satisfies Story;
