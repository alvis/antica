import { expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import { savedPreferences } from '../../../i18n/preferences.spec.fixtures';
import { LocaleProvider } from '../../../providers/LocaleProvider';

import { KnowledgeBrowse } from './KnowledgeBrowse';

import type { ComponentProps } from 'react';

it('should show saved and draft choices when category queries have not started', async () => {
  const browse = {
    groups: [],
    topicId: null,
    tree: { data: undefined },
    selection: { query: '', view: 'saved' },
    setSelection: jest.fn(),
    choose: jest.fn(),
  } as unknown as ComponentProps<typeof KnowledgeBrowse>;
  await render(
    <LocaleProvider preferences={savedPreferences('en')}>
      <KnowledgeBrowse {...browse} />
    </LocaleProvider>,
  );

  expect(screen.getByTestId('knowledge-status-saved')).toBeTruthy();
  expect(screen.getByTestId('knowledge-status-draft')).toBeTruthy();
  expect(screen.queryByTestId('knowledge-loading')).toBeNull();
});
