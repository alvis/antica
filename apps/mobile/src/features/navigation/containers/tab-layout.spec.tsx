import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent, waitFor } from '@testing-library/react-native';

import { deleteItemAsync, setItemAsync } from 'expo-secure-store';
import { Text } from 'react-native';

import TabLayout from '../../../app/(private)/(tabs)/_layout';
import { LocaleProvider } from '../../../i18n/LocaleProvider';

import { renderRouter } from 'expo-router/testing-library';

import type { ReactElement } from 'react';

jest.mock('expo-secure-store', () => {
  const storage = new Map<string, string>();

  return {
    getItemAsync: jest.fn(
      async (key: string): Promise<string | null> => storage.get(key) ?? null,
    ),
    setItemAsync: jest.fn(async (key: string, value: string): Promise<void> => {
      storage.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string): Promise<void> => {
      storage.delete(key);
    }),
  } satisfies Partial<typeof import('expo-secure-store')>;
});

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
      language: 'English',
      storedLocale: null,
      titles: ['Collection', 'Tasks', 'Knowledge', 'Research'],
    },
    {
      language: 'Traditional Chinese after locale restoration',
      storedLocale: 'zh-Hant',
      titles: ['藏品', '待辦', '知識庫', '研究'],
    },
  ])(
    'should label and navigate the collector journeys in $language',
    async ({ storedLocale, titles }) => {
      await deleteItemAsync('antica.locale');
      if (storedLocale !== null) {
        await setItemAsync('antica.locale', storedLocale);
      }
      const pending = renderRouter(
        {
          _layout: TabLayout,
          collection: CollectionScene,
          tasks: TasksScene,
          knowledge: KnowledgeScene,
          research: ResearchScene,
        },
        { initialUrl: '/collection', wrapper: LocaleProvider },
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
