import { describe, expect, it, jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react-native';

import { useEffect } from 'react';
import { Text } from 'react-native';

import {
  localizeKnowledgeKind,
  localizeProposalField,
  localizeStatus,
} from '../i18n/messages';

import {
  LocaleProvider,
  useInterfaceLanguage,
  useLocale,
} from './LocaleProvider';
import {
  device,
  renderLanguage,
  saved,
  storage,
} from './LocaleProvider.spec.fixtures';

import type { FC, ReactElement } from 'react';

import type {
  LocalPreferences,
  LocalPreferencesPort,
} from '../i18n/preferences';

describe('cp:LocaleProvider', () => {
  it('should start in Traditional Chinese on an English device when nothing is saved', async () => {
    const view = await renderLanguage(storage(null), device(['en-US']));

    expect(view.result.current.locale).toBe('zh-Hant');
    expect(view.result.current.resolved).toEqual({
      preference: 'zh-Hant',
      locale: 'zh-Hant',
      usedSystemFallback: false,
    });
    expect(view.result.current.t('settings')).toBe('設定');
  });

  it.each([
    { stored: 'zh-Hant', settings: '設定', messages: '訊息' },
    { stored: 'zh-Hans', settings: '设置', messages: '消息' },
    { stored: 'en', settings: 'Settings', messages: 'Messages' },
  ] as const)(
    'should restore the saved $stored language on launch',
    async ({ stored, settings, messages }) => {
      const view = await renderLanguage(storage(saved(stored)));

      expect(view.result.current.locale).toBe(stored);
      expect(view.result.current.t('settings')).toBe(settings);
      expect(view.result.current.t('messages')).toBe(messages);
    },
  );

  it('should follow the first supported device language when Follow system is saved', async () => {
    const view = await renderLanguage(
      storage(saved('system')),
      device(['fr-FR', 'zh-SG']),
    );

    expect(view.result.current.resolved).toEqual({
      preference: 'system',
      locale: 'zh-Hans',
      usedSystemFallback: false,
    });
    expect(view.result.current.t('settings')).toBe('设置');
  });

  it('should save a choice and switch every message without remounting the screen', async () => {
    const preferences = storage(null);
    let mounts = 0;
    const Screen: FC = () => {
      useEffect(() => {
        mounts += 1;
      }, []);

      return <Text>{useLocale().t('whatsappLogin')}</Text>;
    };
    const Switch = (): ReactElement => {
      const { save } = useInterfaceLanguage();

      return <Text onPress={() => void save('zh-Hans')}>switch</Text>;
    };
    await render(
      <LocaleProvider preferences={preferences}>
        <Screen />
        <Switch />
      </LocaleProvider>,
    );
    expect(screen.getByText('使用 WhatsApp 登入')).toBeTruthy();

    await fireEvent.press(screen.getByText('switch'));

    expect(preferences.write.mock.calls).toEqual([[saved('zh-Hans')]]);
    expect(screen.getByText('使用 WhatsApp 登录')).toBeTruthy();
    expect(mounts).toBe(1);
  });

  it('should keep the previous language when the choice cannot be stored', async () => {
    const preferences = storage(saved('en'));
    const failure = new Error('Keychain unavailable.');
    preferences.write.mockRejectedValueOnce(failure);
    const view = await renderLanguage(preferences);

    await expect(
      act(async () => view.result.current.save('zh-Hant')),
    ).rejects.toBe(failure);

    expect(view.result.current.saved).toEqual(saved('en'));
    expect(view.result.current.locale).toBe('en');
  });

  it('should save the active language again without changing it', async () => {
    const preferences = storage(saved('en'));
    const view = await renderLanguage(preferences);

    await act(async () => view.result.current.save('en'));

    expect(preferences.write.mock.calls).toEqual([[saved('en')]]);
    expect(view.result.current.locale).toBe('en');
  });

  it('should use Traditional Chinese and offer another read when the saved language cannot be read', async () => {
    const preferences = storage(saved('en'));
    preferences.read.mockRejectedValueOnce(new Error('Keychain locked.'));
    const view = await renderLanguage(preferences);

    expect(view.result.current.status).toBe('read_failed');
    expect(view.result.current.locale).toBe('zh-Hant');
    expect(view.result.current.saved).toEqual(saved('zh-Hant'));
    expect(preferences.write).not.toHaveBeenCalled();

    await act(async () => view.result.current.retryRead());

    expect(view.result.current.status).toBe('ready');
    expect(view.result.current.locale).toBe('en');
  });

  it('should stay on the safe default when another read also fails', async () => {
    const preferences = storage(saved('en'));
    preferences.read.mockRejectedValue(new Error('Keychain locked.'));
    const view = await renderLanguage(preferences);

    await act(async () => view.result.current.retryRead());

    expect(view.result.current.status).toBe('read_failed');
    expect(view.result.current.locale).toBe('zh-Hant');
  });

  it('should keep a saved choice when an earlier read finishes after it', async () => {
    const preferences = storage(null);
    const view = await renderLanguage(preferences);
    const read = Promise.withResolvers<LocalPreferences | null>();
    preferences.read.mockReturnValueOnce(read.promise);
    const retry = view.result.current.retryRead();

    await act(async () => view.result.current.save('en'));
    await act(async () => {
      read.resolve(saved('zh-Hans'));
      await retry;
    });

    expect(view.result.current.locale).toBe('en');
  });

  it('should ignore a read that finishes after the provider unmounts', async () => {
    const read = Promise.withResolvers<LocalPreferences | null>();
    const failed = Promise.withResolvers<LocalPreferences | null>();
    const preferences = {
      read: jest
        .fn<LocalPreferencesPort['read']>()
        .mockReturnValueOnce(read.promise)
        .mockReturnValueOnce(failed.promise),
      write: jest.fn(async () => undefined),
    };
    const first = await render(<LocaleProvider preferences={preferences} />);
    const second = await render(<LocaleProvider preferences={preferences} />);
    await first.unmount();
    await second.unmount();

    await act(async () => {
      read.resolve(saved('en'));
      failed.reject(new Error('Keychain locked.'));
    });

    expect(preferences.read).toHaveBeenCalledTimes(2);
  });

  it('should preview a choice in its own language without switching the interface', async () => {
    const view = await renderLanguage(storage(null), device(['ja-JP']));
    const english = view.result.current.preview('en');
    const system = view.result.current.preview('system');

    expect(english.t('save')).toBe('Save');
    expect(system.resolved).toEqual({
      preference: 'system',
      locale: 'zh-Hant',
      usedSystemFallback: true,
    });
    expect(view.result.current.t('save')).toBe('儲存');
  });

  it('should interpolate values and pick plural forms in each language', async () => {
    const view = await renderLanguage(storage(saved('en')));

    expect(view.result.current.t('applyDecisionsCount', { count: 2 })).toBe(
      'Apply decisions (2)',
    );
    expect(view.result.current.t('citationCount', { count: 1 })).toBe(
      '1 Citation',
    );
    expect(view.result.current.t('citationCount', { count: 3 })).toBe(
      '3 Citations',
    );
    await act(async () => view.result.current.save('zh-Hant'));
    expect(view.result.current.t('applyDecisionsCount', { count: 2 })).toBe(
      '套用決定 (2)',
    );
  });

  it('should only accept known keys with the values their text needs', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const view = await renderLanguage(storage(saved('en')));
    const { t } = view.result.current;

    // @ts-expect-error unknown keys do not typecheck
    expect(t('unknownKey')).toBe('unknownKey');
    // @ts-expect-error interpolated messages require their values
    expect(t('applyDecisionsCount')).toBe('Apply decisions ({{count}})');
    // @ts-expect-error plural suffixes are not keys of their own
    expect(t('citationCount_one')).toBe('{{count}} Citation');
  });

  it('should translate known statuses and display readable future statuses', async () => {
    const view = await renderLanguage(storage(null));
    const { t } = view.result.current;

    expect(localizeStatus('needs_review', t)).toBe('來源待核對');
    expect(localizeStatus('awaiting_archive', t)).toBe('awaiting archive');
    expect(localizeProposalField('materialIds', t)).toBe('材質');
    expect(localizeKnowledgeKind('object_type', t)).toBe('器類');
  });

  it.each([
    { hook: 'useLocale', use: (): unknown => useLocale() },
    {
      hook: 'useInterfaceLanguage',
      use: (): unknown => useInterfaceLanguage(),
    },
  ])('should reject $hook without a locale provider', async ({ use }) => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(renderHook(use)).rejects.toThrow('LocaleProvider is missing.');
  });
});
