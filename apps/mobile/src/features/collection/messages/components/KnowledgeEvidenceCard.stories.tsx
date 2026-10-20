import { savedPreferences } from '../../../../i18n/preferences.spec.fixtures';
import { LocaleProvider } from '../../../../providers/LocaleProvider';

import { historicalAnswer } from '../containers/record-messages-knowledge.spec.fixtures';

import { KnowledgeEvidenceCard } from './KnowledgeEvidenceCard';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

const meta = {
  title: 'Mobile/Features/Collection/KnowledgeEvidenceCard',
  component: KnowledgeEvidenceCard,
  decorators: [
    (story) => (
      <LocaleProvider preferences={savedPreferences('en')}>
        {story()}
      </LocaleProvider>
    ),
  ],
  args: { message: historicalAnswer },
} satisfies Meta<typeof KnowledgeEvidenceCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const FrozenHistoricalSources = {} satisfies Story;
export const LegacyWithoutEvidence = {
  args: { message: { ...historicalAnswer, knowledgeEvidence: [] } },
} satisfies Story;
