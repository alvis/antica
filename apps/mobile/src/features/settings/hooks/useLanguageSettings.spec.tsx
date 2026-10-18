import { describe, expect, it, jest } from '@jest/globals';

import { act, renderHook } from '@testing-library/react-native';

import { LocaleProvider } from '../../../providers/LocaleProvider';

import { useLanguageSettings } from './useLanguageSettings';

import type { PropsWithChildren, ReactElement } from 'react';

import type { LocalPreferencesPort } from '../../../i18n/preferences';

describe('hk:useLanguageSettings', () => {
  it('should write once when a second save starts before the screen re-renders', async () => {
    const write = Promise.withResolvers<void>();
    const preferences = {
      read: jest.fn<LocalPreferencesPort['read']>(async () => null),
      write: jest.fn<LocalPreferencesPort['write']>(async () => write.promise),
    };
    const Device = ({ children }: PropsWithChildren): ReactElement => (
      <LocaleProvider
        preferences={preferences}
        systemLocales={{ readLanguageTags: () => ['en-US'] }}>
        {children}
      </LocaleProvider>
    );
    const view = await renderHook(useLanguageSettings, { wrapper: Device });
    await act(async () => view.result.current.select('en'));

    await act(async () => {
      const first = view.result.current.save();
      const second = view.result.current.save();
      write.resolve();
      await Promise.all([first, second]);
    });

    expect(preferences.write).toHaveBeenCalledTimes(1);
    expect(view.result.current.updated).toBe(true);
  });
});
