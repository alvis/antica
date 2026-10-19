import { MobileStoryShell } from '../../../mobile.stories.fixtures';
import {
  findStoryButton,
  findStoryElement,
  findStoryText,
} from '../../../mobile.stories.helpers';

import { LanguageSettingsContainer } from './LanguageSettingsContainer';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

const meta = {
  title: 'Mobile/Features/Settings/LanguageSettingsContainer',
  component: LanguageSettingsContainer,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Interface-language selector with a preview, reachable before and after sign-in',
      },
    },
  },
} satisfies Meta<typeof LanguageSettingsContainer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** a new installation previews English, then saves it and switches in place */
export const TraditionalChinese = {
  render: () => (
    <MobileStoryShell locale="zh-Hant" responses={{}}>
      <LanguageSettingsContainer />
    </MobileStoryShell>
  ),
  play: async ({ canvasElement }) => {
    await findStoryText(canvasElement, '語言 / Language');
    await findStoryElement(
      canvasElement,
      '[role="radio"][aria-label="繁體中文, 預設"][aria-checked="true"]',
    );
    (
      await findStoryElement(
        canvasElement,
        '[role="radio"][aria-label="English"]',
      )
    ).click();
    await findStoryText(canvasElement, 'Settings · Language');
    (await findStoryButton(canvasElement, '儲存')).click();
    await findStoryText(canvasElement, 'Interface language updated');
    await findStoryText(canvasElement, 'Language / 語言');
  },
} satisfies Story;

/** an English interface previews Traditional Chinese, keeping language names in their own scripts */
export const English = {
  render: () => (
    <MobileStoryShell locale="en" responses={{}}>
      <LanguageSettingsContainer />
    </MobileStoryShell>
  ),
  play: async ({ canvasElement }) => {
    await findStoryText(canvasElement, 'Language / 語言');
    (
      await findStoryElement(
        canvasElement,
        '[role="radio"][aria-label="繁體中文, Default"]',
      )
    ).click();
    await findStoryText(canvasElement, '設定 · 語言');
    await findStoryText(canvasElement, '儲存 / 取消');
    (await findStoryButton(canvasElement, 'Cancel')).click();
    await findStoryText(canvasElement, 'Language / 語言');
  },
} satisfies Story;
