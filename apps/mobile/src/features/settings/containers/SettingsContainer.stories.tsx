import { MobileStoryShell } from '../../../mobile.stories.fixtures';
import {
  findStoryButton,
  findStoryText,
} from '../../../mobile.stories.helpers';

import { SettingsContainer } from './SettingsContainer';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

const meta = {
  title: 'Mobile/Features/Settings/SettingsContainer',
  component: SettingsContainer,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Settings home with the device interface language and the existing sign-out action',
      },
    },
  },
} satisfies Meta<typeof SettingsContainer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** the default Traditional Chinese interface */
export const TraditionalChinese = {
  render: () => (
    <MobileStoryShell locale="zh-Hant" responses={{}}>
      <SettingsContainer />
    </MobileStoryShell>
  ),
  play: async ({ canvasElement }) => {
    await findStoryText(canvasElement, '語言 · 繁體中文');
    await findStoryText(
      canvasElement,
      '只更改此裝置的介面語言，不會翻譯藏品內容或重新分析。',
    );
    await findStoryButton(canvasElement, '登出');
  },
} satisfies Story;

/** a saved English choice; the Language row opens the selector */
export const English = {
  render: () => (
    <MobileStoryShell locale="en" responses={{}}>
      <SettingsContainer />
    </MobileStoryShell>
  ),
  play: async ({ canvasElement }) => {
    (await findStoryButton(canvasElement, 'Language, English')).click();
    await findStoryText(
      canvasElement,
      "Changes this device's interface language only. Collection content is not translated or reanalysed.",
    );
    await findStoryButton(canvasElement, 'Sign out');
  },
} satisfies Story;
