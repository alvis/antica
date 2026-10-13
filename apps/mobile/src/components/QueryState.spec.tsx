import { expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { Text } from 'react-native';

import { LocaleProvider } from '../locale';

import { QueryState } from './QueryState';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

it('should replace loading and errors with content and expose retry', async () => {
  const retry = jest.fn();
  const view = await render(
    <LocaleProvider>
      <QueryState loading error={null} retry={retry}>
        <Text>Loaded evidence</Text>
      </QueryState>
    </LocaleProvider>,
  );
  expect(screen.getByRole('progressbar')).toBeTruthy();
  expect(screen.queryByText('Loaded evidence')).toBeNull();
  await view.rerender(
    <LocaleProvider>
      <QueryState
        loading={false}
        error={new Error('Network unavailable')}
        retry={retry}>
        <Text>Loaded evidence</Text>
      </QueryState>
    </LocaleProvider>,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Network unavailable');
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  expect(retry).toHaveBeenCalledTimes(1);
  await view.rerender(
    <LocaleProvider>
      <QueryState loading={false} error={null} retry={retry}>
        <Text>Loaded evidence</Text>
      </QueryState>
    </LocaleProvider>,
  );
  expect(screen.getByText('Loaded evidence')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('should provide localized fallback feedback when a failure has no message', async () => {
  await render(
    <LocaleProvider>
      <QueryState loading={false} error={new Error()} retry={jest.fn()} />
    </LocaleProvider>,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong.');
});
