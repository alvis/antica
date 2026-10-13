import { describe, expect, it, jest } from '@jest/globals';
import { render, waitFor } from '@testing-library/react-native';

import { Tabs } from 'expo-router';
import { getItemAsync } from 'expo-secure-store';

import TabLayout from '../../app/(private)/(tabs)/_layout';
import { LocaleProvider } from '../../locale';

jest.mock(
  'expo-router',
  () =>
    ({
      Tabs: Object.assign(
        jest.fn(({ children }: { children: React.ReactNode }) => {
          const { View } =
            jest.requireActual<typeof import('react-native')>('react-native');

          return <View>{children}</View>;
        }),
        jest.requireActual<typeof import('expo-router')>('expo-router').Tabs,
        {
          Screen: jest.fn<typeof import('expo-router').Tabs.Screen>(() => null),
        },
      ),
    }) satisfies Partial<typeof import('expo-router')>,
);
jest.mock(
  'expo-secure-store',
  () =>
    ({
      getItemAsync: jest.fn(async () => null),
      setItemAsync: jest.fn(async () => undefined),
    }) satisfies Partial<typeof import('expo-secure-store')>,
);

const tabTitle = (
  props: Parameters<typeof Tabs.Screen>[0],
): string | undefined =>
  typeof props.options === 'function' ? undefined : props.options?.title;
const englishTitles = ['Collection', 'Tasks', 'Knowledge', 'Research'];
const chineseTitles = ['藏品', '待辦', '知識庫', '研究'];

describe('rc:TabLayout', () => {
  it('should label the collector journeys in English', async () => {
    await render(
      <LocaleProvider>
        <TabLayout />
      </LocaleProvider>,
    );

    expect(
      jest.mocked(Tabs.Screen).mock.calls.map(([props]) => tabTitle(props)),
    ).toEqual(englishTitles);
  });

  it('should label the same journeys in Traditional Chinese after locale restoration', async () => {
    jest.mocked(getItemAsync).mockResolvedValueOnce('zh-Hant');
    await render(
      <LocaleProvider>
        <TabLayout />
      </LocaleProvider>,
    );

    await waitFor(() => {
      const call = jest
        .mocked(Tabs.Screen)
        .mock.calls.at(-chineseTitles.length);
      expect(call && tabTitle(call[0])).toBe('藏品');
    });
    expect(
      jest
        .mocked(Tabs.Screen)
        .mock.calls.slice(-chineseTitles.length)
        .map(([props]) => tabTitle(props)),
    ).toEqual(chineseTitles);
  });
});
