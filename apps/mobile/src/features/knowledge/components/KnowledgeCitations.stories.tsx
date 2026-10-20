import { savedPreferences } from '../../../i18n/preferences.spec.fixtures';
import { LocaleProvider } from '../../../providers/LocaleProvider';

import { citation } from './knowledge.spec.fixtures';
import { KnowledgeCitations } from './KnowledgeCitations';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

const meta = {
  title: 'Mobile/Features/Knowledge/KnowledgeCitations',
  component: KnowledgeCitations,
  decorators: [
    (story) => (
      <LocaleProvider preferences={savedPreferences('en')}>
        {story()}
      </LocaleProvider>
    ),
  ],
  args: { citations: [citation], testIDPrefix: 'story-citation' },
} satisfies Meta<typeof KnowledgeCitations>;
export default meta;
export const CapturedSource = {} satisfies StoryObj<typeof meta>;
