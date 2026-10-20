import { savedPreferences } from '../../../i18n/preferences.spec.fixtures';
import { findStoryElement } from '../../../mobile.stories.helpers';
import { LocaleProvider } from '../../../providers/LocaleProvider';
import { expect, fn } from 'storybook/test';

import { topic } from './knowledge.spec.fixtures';
import { TopicBrowse } from './TopicBrowse';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

const meta = {
  title: 'Mobile/Features/Knowledge/TopicBrowse',
  component: TopicBrowse,
  tags: ['autodocs'],
  decorators: [
    (story) => (
      <LocaleProvider preferences={savedPreferences('en')}>
        {story()}
      </LocaleProvider>
    ),
  ],
  args: {
    topics: [topic],
    selected: [],
    onSelect: fn(),
    category: true,
    filter: false,
  },
  argTypes: {
    topics: {
      control: false,
      description: 'Direct topic choices from the API',
    },
    selected: { control: false, description: 'Selected topic identities' },
    onSelect: { control: false, description: 'Selects a topic' },
    category: {
      control: 'boolean',
      description: 'Uses the category test identity',
    },
    filter: {
      control: 'boolean',
      description: 'Uses the filter test identity',
    },
  },
} satisfies Meta<typeof TopicBrowse>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Category = {
  play: async ({ args, canvasElement }) => {
    (await findStoryElement(canvasElement, '[role="button"]')).click();
    await expect(args.onSelect).toHaveBeenCalledWith(topic);
  },
} satisfies Story;

export const SelectedOriginalLabel = {
  args: {
    topics: [{ ...topic, fallback: true, language: 'zh-Hant' }],
    selected: [topic.id],
    category: false,
    filter: true,
  },
} satisfies Story;
