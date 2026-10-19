import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent, waitFor } from '@testing-library/react-native';

import { Text } from 'react-native';

import TabLayout from '../../../app/(private)/(tabs)/_layout';
import { memoryPreferences } from '../../../i18n/preferences.spec.fixtures';
import { LocaleProvider } from '../../../providers/LocaleProvider';

import { renderRouter } from 'expo-router/testing-library';

import type { FC, PropsWithChildren, ReactElement } from 'react';

const CollectionScene = (): ReactElement => <Text>Collection route</Text>;
const TasksScene = (): ReactElement => <Text>Tasks route</Text>;
const KnowledgeScene = (): ReactElement => <Text>Knowledge route</Text>;
const ResearchScene = (): ReactElement => <Text>Research route</Text>;

const routes = ['collection', 'tasks', 'knowledge', 'research'] as const;
const sceneLabels = [
  'Collection route',
  'Tasks route',
  'Knowledge route',
  'Research route',
];

describe('rc:TabLayout', () => {
  it.each([
    {
      language: 'Traditional Chinese on a new installation',
      storedLocale: null,
      titles: ['藏品', '待辦', '知識庫', '研究'],
    },
    {
      language: 'English once it is saved',
      storedLocale: 'en' as const,
      titles: ['Collection', 'Tasks', 'Knowledge', 'Research'],
    },
  ])(
    'should label and navigate the collector journeys in $language',
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
          collection: CollectionScene,
          tasks: TasksScene,
          knowledge: KnowledgeScene,
          research: ResearchScene,
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
        await user.press(screen.getByText(titles[index]));
        await waitFor(() => {
          expect(pending.getPathname()).toBe(`/${route}`);
          expect(screen.getByText(sceneLabels[index])).toBeVisible();
        });
      }
    },
  );
});
