import { savedPreferences } from '../../../i18n/preferences.spec.fixtures';
import { LocaleProvider } from '../../../providers/LocaleProvider';
import { fn } from 'storybook/test';

import { relatedCard } from '../containers/related-knowledge.spec.fixtures';

import { RelatedKnowledgeCard } from './RelatedKnowledgeCard';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

const meta = {
  title: 'Mobile/Features/Knowledge/RelatedKnowledgeCard',
  component: RelatedKnowledgeCard,
  tags: ['autodocs'],
  decorators: [
    (story) => (
      <LocaleProvider preferences={savedPreferences('en')}>
        {story()}
      </LocaleProvider>
    ),
  ],
  args: { card: relatedCard, onOpen: fn() },
} satisfies Meta<typeof RelatedKnowledgeCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SavedWithCitations = {} satisfies Story;
export const Candidate = { args: { onAttach: fn() } } satisfies Story;
export const AttachmentLimit = {
  args: { onAttach: fn(), attachDisabled: true },
} satisfies Story;
export const WithoutExcerpt = {
  args: {
    card: { ...relatedCard, kind: 'method', fallback: false, excerpt: null },
  },
} satisfies Story;
export const TraditionalChinese = {
  decorators: [
    (story) => (
      <LocaleProvider preferences={savedPreferences('zh-Hant')}>
        {story()}
      </LocaleProvider>
    ),
  ],
  args: { onAttach: fn() },
} satisfies Story;
