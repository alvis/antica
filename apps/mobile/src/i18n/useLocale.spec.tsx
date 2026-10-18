import { describe, expect, it, jest } from '@jest/globals';
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { getItemAsync, setItemAsync } from 'expo-secure-store';
import { Text } from 'react-native';

import { LocaleProvider, useLocale } from './LocaleProvider';
import {
  localizeKnowledgeKind,
  localizeProposalField,
  localizeStatus,
} from './messages';

import type { FC } from 'react';

jest.mock(
  'expo-secure-store',
  () =>
    ({
      getItemAsync: jest.fn(async () => null),
      setItemAsync: jest.fn(async () => undefined),
    }) satisfies Partial<typeof import('expo-secure-store')>,
);

describe('hk:useLocale', () => {
  it('should start in English when no language is saved', async () => {
    const view = await renderHook(useLocale, { wrapper: LocaleProvider });

    await waitFor(() =>
      expect(getItemAsync).toHaveBeenCalledWith('antica.locale'),
    );
    expect(view.result.current.locale).toBe('en');
    expect(view.result.current.t('settings')).toBe('Settings');
  });

  it.each([
    { saved: 'zh-Hant', settings: '設定', messages: '訊息' },
    { saved: 'zh-Hans', settings: '设置', messages: '消息' },
    { saved: 'en', settings: 'Settings', messages: 'Messages' },
  ] as const)(
    'should restore the saved $saved language for a new session',
    async ({ saved, settings, messages }) => {
      jest.mocked(getItemAsync).mockResolvedValueOnce(saved);
      const view = await renderHook(useLocale, { wrapper: LocaleProvider });

      await waitFor(() => expect(view.result.current.locale).toBe(saved));
      expect(view.result.current.t('settings')).toBe(settings);
      expect(view.result.current.t('messages')).toBe(messages);
    },
  );

  it('should ignore a saved value that is not a supported language', async () => {
    jest.mocked(getItemAsync).mockResolvedValueOnce('fr');
    const view = await renderHook(useLocale, { wrapper: LocaleProvider });

    await waitFor(() => expect(getItemAsync).toHaveBeenCalled());
    expect(view.result.current.locale).toBe('en');
  });

  it('should keep a language chosen before the saved one finishes loading', async () => {
    const saved = Promise.withResolvers<string | null>();
    jest.mocked(getItemAsync).mockReturnValueOnce(saved.promise);
    const view = await renderHook(useLocale, { wrapper: LocaleProvider });

    await act(async () => view.result.current.setLocale('zh-Hans'));
    await act(async () => saved.resolve('zh-Hant'));

    expect(view.result.current.locale).toBe('zh-Hans');
    expect(view.result.current.t('settings')).toBe('设置');
  });

  it('should not apply a saved language after the provider unmounts', async () => {
    const saved = Promise.withResolvers<string | null>();
    jest.mocked(getItemAsync).mockReturnValueOnce(saved.promise);
    let renders = 0;
    const view = await renderHook(
      () => {
        renders += 1;

        return useLocale();
      },
      { wrapper: LocaleProvider },
    );
    await view.unmount();
    const rendersAtUnmount = renders;

    await act(async () => saved.resolve('zh-Hant'));
    expect(renders).toBe(rendersAtUnmount);
    expect(view.result.current.locale).toBe('en');
  });

  it('should persist the selected language and switch every message', async () => {
    const view = await renderHook(useLocale, { wrapper: LocaleProvider });

    await act(async () => view.result.current.setLocale('zh-Hans'));
    expect(setItemAsync).toHaveBeenCalledWith('antica.locale', 'zh-Hans');
    expect(view.result.current.locale).toBe('zh-Hans');
    expect(view.result.current.t('whatsappLogin')).toBe('使用 WhatsApp 登录');

    await act(async () => view.result.current.setLocale('zh-Hant'));
    expect(setItemAsync).toHaveBeenLastCalledWith('antica.locale', 'zh-Hant');
    expect(view.result.current.t('whatsappLogin')).toBe('使用 WhatsApp 登入');
  });

  it('should interpolate values into each language’s text', async () => {
    const view = await renderHook(useLocale, { wrapper: LocaleProvider });
    const { t } = view.result.current;

    expect(t('applyDecisionsCount', { count: 2 })).toBe('Apply decisions (2)');
    expect(t('openSuggestionFor', { field: 'Name', time: 'Oct 16' })).toBe(
      'Open the suggestion: Name, Oct 16',
    );
    await act(async () => view.result.current.setLocale('zh-Hant'));
    expect(view.result.current.t('applyDecisionsCount', { count: 2 })).toBe(
      '套用決定 (2)',
    );
  });

  it('should pick the plural form from the count', async () => {
    const view = await renderHook(useLocale, { wrapper: LocaleProvider });

    expect(view.result.current.t('citationCount', { count: 1 })).toBe(
      '1 Citation',
    );
    expect(view.result.current.t('citationCount', { count: 3 })).toBe(
      '3 Citations',
    );
    await act(async () => view.result.current.setLocale('zh-Hans'));
    expect(view.result.current.t('citationCount', { count: 1 })).toBe('1 引用');
  });

  it('should only accept known keys with the values their text needs', async () => {
    const view = await renderHook(useLocale, { wrapper: LocaleProvider });
    const { t } = view.result.current;

    // @ts-expect-error unknown keys do not typecheck
    expect(t('unknownKey')).toBe('unknownKey');
    // @ts-expect-error interpolated messages require their values
    expect(t('applyDecisionsCount')).toBe('Apply decisions ({{count}})');
    // @ts-expect-error plural suffixes are not keys of their own
    expect(t('citationCount_one')).toBe('{{count}} Citation');
  });

  it('should render a screen in Simplified Chinese', async () => {
    jest.mocked(getItemAsync).mockResolvedValueOnce('zh-Hans');
    const Greeting: FC = () => {
      const { t } = useLocale();

      return (
        <>
          <Text>{t('privateCollection')}</Text>
          <Text>{t('sentToPhone', { phone: '••••0001' })}</Text>
        </>
      );
    };

    await render(
      <LocaleProvider>
        <Greeting />
      </LocaleProvider>,
    );

    expect(await screen.findByText('您的私人藏品与研究')).toBeTruthy();
    expect(screen.getByText('验证码已发送至 ••••0001')).toBeTruthy();
  });

  it('should reject use without a locale provider', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(renderHook(useLocale)).rejects.toThrow(
      'LocaleProvider is missing.',
    );
  });

  it('should translate known statuses and display readable future statuses', async () => {
    const view = await renderHook(useLocale, { wrapper: LocaleProvider });
    await act(async () => view.result.current.setLocale('zh-Hant'));
    const { t } = view.result.current;

    expect(localizeStatus('needs_review', t)).toBe('來源待核對');
    expect(localizeStatus('awaiting_archive', t)).toBe('awaiting archive');
    expect(localizeProposalField('materialIds', t)).toBe('材質');
    expect(localizeKnowledgeKind('object_type', t)).toBe('器類');
  });
});
