import { savedPreferences } from '../../../i18n/preferences.spec.fixtures';
import { findStoryElement } from '../../../mobile.stories.helpers';
import { LocaleProvider } from '../../../providers/LocaleProvider';
import { expect, fn } from 'storybook/test';

import { hit } from './knowledge.spec.fixtures';
import { KnowledgeResultCard } from './KnowledgeResultCard';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

const meta = {
  title: 'Mobile/Features/Knowledge/KnowledgeResultCard',
  component: KnowledgeResultCard,
  tags: ['autodocs'],
  decorators: [
    (story) => (
      <LocaleProvider preferences={savedPreferences('en')}>
        {story()}
      </LocaleProvider>
    ),
  ],
  args: { hit, onOpen: fn() },
  argTypes: {
    hit: { control: false, description: 'Revision-pinned discovery result' },
    onOpen: { control: false, description: 'Opens the entry for reading' },
  },
} satisfies Meta<typeof KnowledgeResultCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MuseumExampleWithOriginalFallback = {
  play: async ({ args, canvasElement }) => {
    (await findStoryElement(canvasElement, '[role="button"]')).click();
    await expect(args.onOpen).toHaveBeenCalledTimes(1);
  },
} satisfies Story;

export const ReviewedConcept = {
  args: {
    hit: {
      ...hit,
      kind: 'concept',
      fallback: false,
      language: 'en',
      title: 'Glaze and surface',
      excerpt: null,
    },
  },
} satisfies Story;
