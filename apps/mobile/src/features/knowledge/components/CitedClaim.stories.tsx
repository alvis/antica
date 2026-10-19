import { savedPreferences } from '../../../i18n/preferences.spec.fixtures';
import { LocaleProvider } from '../../../providers/LocaleProvider';
import { fn } from 'storybook/test';

import { CitedClaim } from './CitedClaim';
import { citation, claim } from './knowledge.spec.fixtures';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

const meta = {
  title: 'Mobile/Features/Knowledge/CitedClaim',
  component: CitedClaim,
  tags: ['autodocs'],
  decorators: [
    (story) => (
      <LocaleProvider preferences={savedPreferences('en')}>
        {story()}
      </LocaleProvider>
    ),
  ],
  args: { claim, citations: [citation], original: false, onCitation: fn() },
  argTypes: {
    claim: { control: false, description: 'Granular reviewed claim' },
    citations: { control: false, description: 'Captured citation evidence' },
    original: { control: 'boolean', description: 'Shows original text' },
    onCitation: { control: false, description: 'Opens a citation panel' },
  },
} satisfies Meta<typeof CitedClaim>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReviewedTranslation = {} satisfies Story;

export const OriginalText = { args: { original: true } } satisfies Story;

export const NeedsSource = {
  args: {
    claim: {
      ...claim,
      supportState: 'needs_source',
      citationIds: [],
      variants: [],
    },
    citations: [],
  },
} satisfies Story;
