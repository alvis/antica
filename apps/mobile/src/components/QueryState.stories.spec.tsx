import { expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import meta, {
  Empty,
  Failed,
  FallbackError,
  Loaded,
  Loading,
} from './QueryState.stories';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

it('should recover the failed query story to loaded content after retry', async () => {
  const FailedStory = Failed.render;
  await render(
    meta.decorators[0](() => <FailedStory {...meta.args} {...Failed.args} />),
  );
  expect(screen.getByRole('alert')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(screen.getByText(/saved references/)).toBeTruthy();
});

it('should distinguish loading, empty and loaded story content', async () => {
  const LoadingStory = Loading.render;
  const EmptyStory = Empty.render;
  const LoadedStory = Loaded.render;
  const view = await render(
    meta.decorators[0](() => <LoadingStory {...meta.args} {...Loading.args} />),
  );
  expect(screen.getByRole('progressbar')).toBeTruthy();
  expect(screen.queryByText(/saved references/)).toBeNull();
  await view.rerender(
    meta.decorators[0](() => <EmptyStory {...meta.args} {...Empty.args} />),
  );
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.getByText(/No collected references/)).toBeTruthy();
  await view.rerender(meta.decorators[0](() => <LoadedStory {...meta.args} />));
  expect(screen.getByText(/saved references/)).toBeTruthy();
  expect(screen.queryByText(/No collected references/)).toBeNull();
});

it('should recover a story failure that has no server message', async () => {
  const FallbackStory = FallbackError.render;
  await render(
    meta.decorators[0](() => (
      <FallbackStory {...meta.args} {...FallbackError.args} />
    )),
  );
  expect(screen.getByRole('alert')).toHaveTextContent(/\S/);
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText(/saved references/)).toBeTruthy();
});
