import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent, waitFor } from '@testing-library/react-native';

import { Text } from 'react-native';

import TabLayout from '../../../app/(private)/(tabs)/_layout';
import { memoryPreferences } from '../../../i18n/preferences.spec.fixtures';
import { LocaleProvider } from '../../../providers/LocaleProvider';

import { renderRouter } from 'expo-router/testing-library';

import type { FC, PropsWithChildren, ReactElement } from 'react';

const TodayScene = (): ReactElement => <Text>Today route</Text>;
const CollectionScene = (): ReactElement => <Text>Collection route</Text>;
const KnowledgeScene = (): ReactElement => <Text>Knowledge route</Text>;
const MeScene = (): ReactElement => <Text>Me route</Text>;

const routes = ['today', 'collection', 'knowledge', 'me'] as const;
const sceneLabels = [
  'Today route',
  'Collection route',
  'Knowledge route',
  'Me route',
];

describe('rc:TabLayout', () => {
  it.each([
    {
      language: 'Traditional Chinese on a new installation',
      storedLocale: null,
      titles: ['今天', '藏品', '知識', '我'],
    },
    {
      language: 'English once it is saved',
      storedLocale: 'en' as const,
      titles: ['Today', 'Collection', 'Knowledge', 'Me'],
    },
  ])(
    'should label and navigate the four v5 tabs in $language',
    async ({ storedLocale, titles }) => {
      const preferences = memoryPreferences(
        storedLocale === null
          ? null
          : { schemaVersion: 1, interfaceLanguage: storedLocale },
      );
      const Device: FC<PropsWithChildren> = ({ children }) => (
        <LocaleProvider preferences={preferences}>{children}</LocaleProvider>
      );
      const pending = renderRouter(
        {
          _layout: TabLayout,
          today: TodayScene,
          collection: CollectionScene,
          knowledge: KnowledgeScene,
          me: MeScene,
        },
        { initialUrl: '/collection', wrapper: Device },
      );
      await pending;

      await waitFor(() => {
        for (const title of titles) {
          expect(screen.getByText(title)).toBeVisible();
        }
      });
      expect(pending.getPathname()).toBe('/collection');
      expect(screen.getByText('Collection route')).toBeVisible();

      const user = userEvent.setup({
        advanceTimers: (milliseconds: number): void => {
          jest.advanceTimersByTime(milliseconds);
        },
      });
      for (const [index, route] of routes.entries()) {
        await user.press(screen.getByTestId(`tab-${route}`));
        await waitFor(() => {
          expect(pending.getPathname()).toBe(`/${route}`);
          expect(screen.getByText(sceneLabels[index])).toBeVisible();
        });
      }
    },
  );
});
