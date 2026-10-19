import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { useRouter } from 'expo-router';
import { AccessibilityInfo, BackHandler } from 'react-native';

import LanguageSettingsRoute from '../../../app/settings/language';
import { memoryPreferences } from '../../../i18n/preferences.spec.fixtures';
import { LocaleProvider } from '../../../providers/LocaleProvider';

import type {
  LocalPreferences,
  LocalPreferencesPort,
} from '../../../i18n/preferences';

jest.mock(
  'expo-router',
  () =>
    ({
      useRouter: jest.fn<typeof import('expo-router').useRouter>(),
    }) satisfies Partial<typeof import('expo-router')>,
);

/**
 * creates navigation controls for the language route
 * @param canGoBack whether a screen sits beneath the selector
 * @returns router controls with observable navigation
 */
function navigation(canGoBack: boolean): ReturnType<typeof useRouter> & {
  back: jest.Mock;
  replace: jest.Mock;
} {
  const router = {
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => canGoBack,
    push: jest.fn(),
    navigate: jest.fn(),
    dismiss: jest.fn(),
    dismissTo: jest.fn(),
    dismissAll: jest.fn(),
    canDismiss: () => false,
    setParams: jest.fn(),
    reload: jest.fn(),
    prefetch: jest.fn(),
  } satisfies ReturnType<typeof useRouter>;
  jest.mocked(useRouter).mockReturnValue(router);

  return router;
}

/**
 * wraps storage so tests can observe and fail writes
 * @param initial stored preferences, or null for a new installation
 * @returns observable storage
 */
function storage(initial: LocalPreferences | null): {
  read: jest.Mock<LocalPreferencesPort['read']>;
  write: jest.Mock<LocalPreferencesPort['write']>;
} {
  const device = memoryPreferences(initial);

  return {
    read: jest.fn(device.read),
    write: jest.fn(device.write),
  };
}

/**
 * renders the language route on a device with the given storage and languages
 * @param preferences device preference storage
 * @param tags device languages for Follow system
 */
async function renderLanguage(
  preferences: LocalPreferencesPort,
  tags: readonly string[] = ['en-US'],
): Promise<void> {
  await render(
    <LocaleProvider
      preferences={preferences}
      systemLocales={{ readLanguageTags: () => tags }}>
      <LanguageSettingsRoute />
    </LocaleProvider>,
  );
}

describe('rc:LanguageSettingsRoute', () => {
  it('should list the three choices in their own scripts with the saved one selected', async () => {
    navigation(true);
    await renderLanguage(storage(null), ['en-GB']);

    expect(
      screen.getByRole('header', { name: '語言 / Language' }),
    ).toBeTruthy();
    expect(screen.getByLabelText('語言')).toHaveProp(
      'accessibilityRole',
      'radiogroup',
    );
    expect(
      screen.getAllByRole('radio').map((option) => {
        const { accessibilityLabel, accessibilityState } = option.props as {
          accessibilityLabel: string;
          accessibilityState: { checked?: boolean };
        };

        return [accessibilityLabel, accessibilityState.checked];
      }),
    ).toEqual([
      ['繁體中文, 預設', true],
      ['English', false],
      ['跟隨系統, English', false],
    ]);
  });

  it('should explain when Follow system finds no supported device language', async () => {
    navigation(true);
    await renderLanguage(storage(null), ['fr-FR', 'de-DE']);

    expect(
      screen.getByRole('radio', {
        name: '跟隨系統, 沒有支援的系統語言，使用繁體中文',
      }),
    ).toBeTruthy();
  });

  it('should preview a choice in its own language without saving or switching', async () => {
    navigation(true);
    const preferences = storage(null);
    await renderLanguage(preferences);

    await fireEvent.press(screen.getByRole('radio', { name: 'English' }));

    expect(screen.getByRole('radio', { name: 'English' })).toBeChecked();
    expect(screen.getByText('Settings · Language')).toBeTruthy();
    expect(screen.getByText('Save / Cancel')).toBeTruthy();
    expect(
      screen.getByRole('header', { name: '語言 / Language' }),
    ).toBeTruthy();
    expect(preferences.write).not.toHaveBeenCalled();
  });

  it('should save the choice, switch the interface in place, and announce it', async () => {
    navigation(true);
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => undefined);
    const preferences = storage(null);
    await renderLanguage(preferences);
    expect(screen.getByRole('button', { name: '儲存' })).toBeDisabled();

    await fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    await fireEvent.press(screen.getByRole('button', { name: '儲存' }));

    expect(preferences.write.mock.calls).toEqual([
      [{ schemaVersion: 1, interfaceLanguage: 'en' }],
    ]);
    expect(
      screen.getByRole('header', { name: 'Language / 語言' }),
    ).toBeTruthy();
    expect(screen.getByText('Interface language updated')).toBeTruthy();
    expect(announce.mock.calls).toEqual([['Interface language updated']]);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByTestId('language-cancel')).toHaveTextContent('Done');

    await fireEvent.press(screen.getByRole('radio', { name: /繁體中文/ }));
    expect(screen.queryByText('Interface language updated')).toBeNull();
    expect(screen.getByTestId('language-cancel')).toHaveTextContent('Cancel');
  });

  it.each([
    { name: 'Cancel', canGoBack: true },
    { name: 'Cancel without a screen beneath', canGoBack: false },
  ])(
    'should leave the saved choice unchanged on $name',
    async ({ canGoBack }) => {
      const router = navigation(canGoBack);
      const preferences = storage(null);
      await renderLanguage(preferences);

      await fireEvent.press(screen.getByRole('radio', { name: 'English' }));
      await fireEvent.press(screen.getByRole('button', { name: '取消' }));

      expect(router.back).toHaveBeenCalledTimes(canGoBack ? 1 : 0);
      expect(router.replace.mock.calls).toEqual(canGoBack ? [] : [['/']]);
      expect(preferences.write).not.toHaveBeenCalled();
      expect(
        screen.getByRole('header', { name: '語言 / Language' }),
      ).toBeTruthy();
    },
  );

  it('should keep the previous language when saving fails and save again on Retry', async () => {
    navigation(true);
    const preferences = storage(null);
    preferences.write.mockRejectedValueOnce(new Error('Keychain unavailable.'));
    await renderLanguage(preferences);

    await fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    await fireEvent.press(screen.getByRole('button', { name: '儲存' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      '無法儲存語言，仍使用之前的選擇。',
    );
    expect(
      screen.getByRole('header', { name: '語言 / Language' }),
    ).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'English' })).toBeChecked();

    await fireEvent.press(screen.getByRole('button', { name: '重試' }));

    expect(
      screen.getByRole('header', { name: 'Language / 語言' }),
    ).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(preferences.write).toHaveBeenCalledTimes(2);
  });

  it('should write once for repeated Save presses and lock the choices while saving', async () => {
    navigation(true);
    const preferences = storage(null);
    const write = Promise.withResolvers<void>();
    preferences.write.mockReturnValueOnce(write.promise);
    await renderLanguage(preferences);
    await fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    const save = screen.getByRole('button', { name: '儲存' });

    await fireEvent.press(save);
    await fireEvent.press(save);

    expect(screen.getByRole('button', { name: '儲存' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /繁體中文/ })).toBeDisabled();
    await act(async () => write.resolve());
    expect(preferences.write).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('header', { name: 'Language / 語言' }),
    ).toBeTruthy();
  });

  it('should offer to read an unreadable preference again and still allow saving', async () => {
    navigation(true);
    const preferences = storage({ schemaVersion: 1, interfaceLanguage: 'en' });
    preferences.read.mockRejectedValueOnce(new Error('Keychain locked.'));
    await renderLanguage(preferences);

    expect(screen.getByRole('alert')).toHaveTextContent(
      '無法讀取已儲存的語言，暫時使用繁體中文。',
    );
    expect(screen.getByRole('button', { name: '儲存' })).toBeEnabled();

    await fireEvent.press(screen.getByRole('button', { name: '重試' }));

    expect(
      screen.getByRole('header', { name: 'Language / 語言' }),
    ).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('radio', { name: 'English' })).toBeChecked();
  });

  it('should keep a choice picked before an unreadable preference is read again', async () => {
    navigation(true);
    const preferences = storage({
      schemaVersion: 1,
      interfaceLanguage: 'zh-Hant',
    });
    preferences.read.mockRejectedValueOnce(new Error('Keychain locked.'));
    await renderLanguage(preferences);

    await fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    await fireEvent.press(screen.getByRole('button', { name: '重試' }));

    expect(screen.getByRole('radio', { name: 'English' })).toBeChecked();
  });

  it('should select the saved choice once a slow first read finishes', async () => {
    navigation(true);
    const read = Promise.withResolvers<LocalPreferences | null>();
    await renderLanguage({
      read: async () => read.promise,
      write: async () => undefined,
    });

    await act(async () =>
      read.resolve({ schemaVersion: 1, interfaceLanguage: 'en' }),
    );

    expect(screen.getByRole('radio', { name: 'English' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('should hold Cancel and hardware Back while a save runs', async () => {
    const router = navigation(true);
    const handlers: Array<Parameters<typeof BackHandler.addEventListener>[1]> =
      [];
    const remove = jest.fn();
    jest
      .spyOn(BackHandler, 'addEventListener')
      .mockImplementation((_, handler) => {
        handlers.push(handler);

        return { remove };
      });
    const preferences = storage(null);
    const write = Promise.withResolvers<void>();
    preferences.write.mockReturnValueOnce(write.promise);
    await renderLanguage(preferences);
    await fireEvent.press(screen.getByRole('radio', { name: 'English' }));

    await fireEvent.press(screen.getByRole('button', { name: '儲存' }));

    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    expect(
      handlers.map((handler) =>
        handler({ type: 'hardwareBackPress', timeStamp: 0 }),
      ),
    ).toEqual([true]);
    await act(async () => write.resolve());
    expect(remove).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(router.back).toHaveBeenCalledTimes(1);
  });
});
