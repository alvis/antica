import { savedPreferences } from '../i18n/preferences.spec.fixtures';
import { findStoryButton } from '../mobile.stories.helpers';
import { LocaleProvider } from '../providers/LocaleProvider';

import { SettingsAction } from './SettingsAction';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

const meta = {
  title: 'Mobile/Components/SettingsAction',
  component: SettingsAction,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: 'Labelled gear in each main-tab header that opens Settings',
      },
    },
  },
} satisfies Meta<typeof SettingsAction>;

export default meta;
type Story = StoryObj<typeof meta>;

/** the gear labelled in the default Traditional Chinese interface */
export const TraditionalChinese = {
  render: () => (
    <LocaleProvider preferences={savedPreferences('zh-Hant')}>
      <SettingsAction />
    </LocaleProvider>
  ),
  play: async ({ canvasElement }) => {
    (await findStoryButton(canvasElement, '設定')).click();
  },
} satisfies Story;

/** the gear labelled in Simplified Chinese */
export const SimplifiedChinese = {
  render: () => (
    <LocaleProvider preferences={savedPreferences('zh-Hans')}>
      <SettingsAction />
    </LocaleProvider>
  ),
  play: async ({ canvasElement }) => {
    await findStoryButton(canvasElement, '设置');
  },
} satisfies Story;

/** the gear labelled in English */
export const English = {
  render: () => (
    <LocaleProvider preferences={savedPreferences('en')}>
      <SettingsAction />
    </LocaleProvider>
  ),
  play: async ({ canvasElement }) => {
    await findStoryButton(canvasElement, 'Settings');
  },
} satisfies Story;
