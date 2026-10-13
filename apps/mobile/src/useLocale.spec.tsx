import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { getItemAsync, setItemAsync } from 'expo-secure-store';

import { LocaleProvider, localizeStatus, useLocale } from './locale';

jest.mock(
  'expo-secure-store',
  () =>
    ({
      getItemAsync: jest.fn(async () => null),
      setItemAsync: jest.fn(async () => undefined),
    }) satisfies Partial<typeof import('expo-secure-store')>,
);

describe('hk:useLocale', () => {
  it('should persist the selected language and restore it for a new session', async () => {
    const first = await renderHook(useLocale, { wrapper: LocaleProvider });
    expect(first.result.current.t('settings')).toBe('Settings');
    await act(async () => first.result.current.setLocale('zh-Hant'));
    expect(first.result.current.t('settings')).toBe('設定');
    expect(setItemAsync).toHaveBeenCalledWith('antica.locale', 'zh-Hant');
    await first.unmount();

    jest.mocked(getItemAsync).mockResolvedValueOnce('zh-Hant');
    const restored = await renderHook(useLocale, { wrapper: LocaleProvider });
    await waitFor(() =>
      expect(restored.result.current.t('settings')).toBe('設定'),
    );
    await act(async () => restored.result.current.setLocale('en'));
    expect(restored.result.current.t('settings')).toBe('Settings');
  });

  it('should reject use without a locale provider', async () => {
    await expect(renderHook(useLocale)).rejects.toThrow();
  });

  it('should translate known statuses and display readable future statuses', async () => {
    const view = await renderHook(useLocale, { wrapper: LocaleProvider });
    await act(async () => view.result.current.setLocale('zh-Hant'));
    expect(localizeStatus('needs_review', view.result.current.t)).toBe(
      '來源待核對',
    );
    expect(localizeStatus('awaiting_archive', view.result.current.t)).toBe(
      'awaiting archive',
    );
  });
});
