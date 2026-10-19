import { describe, expect, it, jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';

import { useEffect } from 'react';
import { Text } from 'react-native';

import { LocaleProvider, useLocale } from './LocaleProvider';
import {
  device,
  foreground,
  renderLanguage,
  saved,
  storage,
} from './LocaleProvider.spec.fixtures';

import type { FC } from 'react';

import type { LocalPreferences } from '../i18n/preferences';

/** longest wait for device storage, as the provider applies it */
const readTimeoutMilliseconds = 3_000;
/** promise hops a resolved read takes to reach the provider's state */
const readSettleHops = 5;

describe('cp:LocaleProvider device storage and languages', () => {
  it('should mount the screen at once under a cover until the saved language is read', async () => {
    const read = Promise.withResolvers<LocalPreferences | null>();
    const preferences = {
      read: async () => read.promise,
      write: async () => undefined,
    };
    let mounts = 0;
    const Greeting: FC = () => {
      useEffect(() => {
        mounts += 1;
      }, []);

      return <Text>{useLocale().t('settings')}</Text>;
    };
    await render(
      <LocaleProvider preferences={preferences}>
        <Greeting />
      </LocaleProvider>,
    );

    expect(mounts).toBe(1);
    expect(screen.queryByText('設定')).toBeNull();
    expect(
      screen.getByText('設定', { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(screen.getByLabelText('載入中…')).toBeTruthy();
    await act(async () => read.resolve(saved('en')));
    expect(screen.getByText('Settings')).toBeTruthy();
    expect(screen.queryByTestId('locale-loading')).toBeNull();
    expect(mounts).toBe(1);
  });

  it('should uncover the safe default when storage does not answer, then apply a late answer', async () => {
    jest.useFakeTimers();
    try {
      const read = Promise.withResolvers<LocalPreferences | null>();
      const view = await renderLanguage({
        read: async () => read.promise,
        write: async () => undefined,
      });

      await act(async () =>
        jest.advanceTimersByTime(readTimeoutMilliseconds - 1),
      );
      expect(view.result.current.status).toBe('loading');
      await act(async () => jest.advanceTimersByTime(1));
      expect(view.result.current.status).toBe('read_failed');
      expect(screen.queryByTestId('locale-loading')).toBeNull();
      expect(view.result.current.t('settings')).toBe('設定');

      await act(async () => read.resolve(saved('en')));
      expect(view.result.current.status).toBe('ready');
      expect(view.result.current.t('settings')).toBe('Settings');
    } finally {
      jest.useRealTimers();
    }
  });

  it('should keep a read that lands in the same moment the wait for storage runs out', async () => {
    jest.useFakeTimers();
    try {
      const read = Promise.withResolvers<LocalPreferences | null>();
      const view = await renderLanguage({
        read: async () => read.promise,
        write: async () => undefined,
      });

      await act(async () => {
        read.resolve(saved('en'));
        for (let hop = 0; hop < readSettleHops; hop += 1) {
          await Promise.resolve();
        }
        jest.advanceTimersByTime(readTimeoutMilliseconds);
      });

      expect(view.result.current.status).toBe('ready');
      expect(view.result.current.locale).toBe('en');
    } finally {
      jest.useRealTimers();
    }
  });

  it('should keep loading when the app returns with a new device language before the read ends', async () => {
    const returnToApp = foreground();
    const read = Promise.withResolvers<LocalPreferences | null>();
    const systemLocales = device(['en-US']);
    const view = await renderLanguage(
      { read: async () => read.promise, write: async () => undefined },
      systemLocales,
    );

    systemLocales.readLanguageTags.mockReturnValue(['zh-CN']);
    await returnToApp();

    expect(view.result.current.status).toBe('loading');
    expect(view.result.current.preview('system').resolved.locale).toBe(
      'zh-Hant',
    );
    await act(async () => read.resolve(saved('system')));
    expect(view.result.current.status).toBe('ready');
    expect(view.result.current.locale).toBe('zh-Hant');
  });

  it('should keep a save that finishes after the app returns with a new device language', async () => {
    const returnToApp = foreground();
    const preferences = storage(saved('en'));
    const write = Promise.withResolvers<void>();
    preferences.write.mockReturnValueOnce(write.promise);
    const systemLocales = device(['en-US']);
    const view = await renderLanguage(preferences, systemLocales);
    let saving: Promise<void> = Promise.resolve();
    await act(async () => {
      saving = view.result.current.save('system');
    });

    systemLocales.readLanguageTags.mockReturnValue(['zh-HK']);
    await returnToApp();
    expect(view.result.current.saved).toEqual(saved('en'));
    await act(async () => {
      write.resolve();
      await saving;
    });

    expect(view.result.current.saved).toEqual(saved('system'));
    expect(view.result.current.locale).toBe('zh-Hant');
  });

  it('should re-resolve Follow system when the app returns with a new device language', async () => {
    const returnToApp = foreground();
    const systemLocales = device(['zh-Hant-HK']);
    const view = await renderLanguage(storage(saved('system')), systemLocales);
    expect(view.result.current.locale).toBe('zh-Hant');

    systemLocales.readLanguageTags.mockReturnValue(['en-GB']);
    await returnToApp();

    expect(view.result.current.locale).toBe('en');
    expect(view.result.current.t('settings')).toBe('Settings');
  });

  it('should keep an explicit choice when the device language changes', async () => {
    const returnToApp = foreground();
    const systemLocales = device(['en-US']);
    const view = await renderLanguage(storage(saved('zh-Hant')), systemLocales);

    systemLocales.readLanguageTags.mockReturnValue(['en-GB']);
    await returnToApp();

    expect(view.result.current.locale).toBe('zh-Hant');
    expect(view.result.current.preview('system').resolved.locale).toBe('en');
  });

  it('should keep rendering when the app returns with the same device language', async () => {
    const returnToApp = foreground();
    let renders = 0;
    const Counter: FC = () => {
      renders += 1;

      return <Text>{useLocale().locale}</Text>;
    };
    await render(
      <LocaleProvider
        preferences={storage(saved('system'))}
        systemLocales={device(['zh-TW'])}>
        <Counter />
      </LocaleProvider>,
    );
    const rendersBefore = renders;

    await returnToApp();

    expect(renders).toBe(rendersBefore);
    expect(screen.getByText('zh-Hant')).toBeTruthy();
  });
});
