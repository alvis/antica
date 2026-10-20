import { savedPreferences } from '../../../i18n/preferences.spec.fixtures';
import { LocaleProvider } from '../../../providers/LocaleProvider';
import { fn } from 'storybook/test';

import { CitationPanel } from './CitationPanel';
import { citation } from './knowledge.spec.fixtures';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

const meta = {
  title: 'Mobile/Features/Knowledge/CitationPanel',
  component: CitationPanel,
  tags: ['autodocs'],
  decorators: [
    (story) => (
      <LocaleProvider preferences={savedPreferences('en')}>
        {story()}
      </LocaleProvider>
    ),
  ],
  args: { citation, onClose: fn(), restoreFocus: null },
  argTypes: {
    citation: { control: false, description: 'Captured source and quote' },
    onClose: { control: false, description: 'Restores the reading view' },
    restoreFocus: { control: false, description: 'Native citation trigger' },
  },
} satisfies Meta<typeof CitationPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const StructuredSource = {} satisfies Story;

export const UnavailableUpstream = {
  args: { citation: { ...citation, availability: 'unavailable' } },
} satisfies Story;
