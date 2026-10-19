import {
  MobileStoryShell,
  storyRecord,
} from '../../../mobile.stories.fixtures';

import { relatedPage } from './related-knowledge.spec.fixtures';
import { RelatedKnowledgeContainer } from './RelatedKnowledgeContainer';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

const path = `GET /v1/records/${storyRecord.id}/related-knowledge`;
const meta = {
  title: 'Mobile/Features/Knowledge/RelatedKnowledgeContainer',
  component: RelatedKnowledgeContainer,
  args: {
    recordId: storyRecord.id,
    recordRevision: storyRecord.recordRevision,
  },
} satisfies Meta<typeof RelatedKnowledgeContainer>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Saved = {
  render: (args) => (
    <MobileStoryShell responses={{ [path]: relatedPage }}>
      <RelatedKnowledgeContainer {...args} />
    </MobileStoryShell>
  ),
} satisfies Story;
export const Loading = {
  render: (args) => (
    <MobileStoryShell
      responses={{ [path]: async () => new Promise(() => undefined) }}>
      <RelatedKnowledgeContainer {...args} />
    </MobileStoryShell>
  ),
} satisfies Story;
export const NoMatch = {
  render: (args) => (
    <MobileStoryShell
      responses={{ [path]: { ...relatedPage, cards: [], reason: 'no_match' } }}>
      <RelatedKnowledgeContainer {...args} />
    </MobileStoryShell>
  ),
} satisfies Story;
export const Failure = {
  render: (args) => (
    <MobileStoryShell
      responses={{
        [path]: {
          storyError: {
            status: 503,
            code: 'PROVIDER_UNAVAILABLE',
            message: 'Offline',
          },
        },
      }}>
      <RelatedKnowledgeContainer {...args} />
    </MobileStoryShell>
  ),
} satisfies Story;
