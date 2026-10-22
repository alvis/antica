import { MobileStoryShell } from '../../../../mobile.stories.fixtures';

import { historicalAnswer } from '../containers/record-messages-knowledge.spec.fixtures';

import { KnowledgeEvidenceCard } from './KnowledgeEvidenceCard';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

const meta = {
  title: 'Mobile/Features/Collection/KnowledgeEvidenceCard',
  component: KnowledgeEvidenceCard,
  decorators: [
    // the card previews each entry's live photo and quote; frozen sources show without them
    (story) => <MobileStoryShell responses={{}}>{story()}</MobileStoryShell>,
  ],
  args: { message: historicalAnswer },
} satisfies Meta<typeof KnowledgeEvidenceCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const FrozenHistoricalSources = {} satisfies Story;
export const LegacyWithoutEvidence = {
  args: { message: { ...historicalAnswer, knowledgeEvidence: [] } },
} satisfies Story;
