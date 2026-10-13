import { expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useLocalSearchParams } from 'expo-router';

import ResearchRoute from '../../app/(private)/(tabs)/research';
import NewResearchRoute from '../../app/(private)/research/new';
import { collectionRecord, renderMobile } from '../../mobile.spec.fixtures';

jest.mock('../../auth', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

const researchId = '00000000-0000-4000-8000-000000000070';

it('should navigate from research choices to collection and new research', async () => {
  const view = await renderMobile(<ResearchRoute />, {});
  await fireEvent.press(screen.getByRole('button', { name: 'Collection' }));
  await fireEvent.press(screen.getByRole('button', { name: 'New research' }));
  expect(view.router.push).toHaveBeenNthCalledWith(1, '/collection');
  expect(view.router.push).toHaveBeenNthCalledWith(2, '/research/new');
});

it('should require a question and submit selected research options with the record context', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ recordId: collectionRecord.id });
  const view = await renderMobile(<NewResearchRoute />, {
    post: async () => ({ researchId, jobId: researchId }),
  });
  expect(screen.getByRole('button', { name: 'Start research' })).toBeDisabled();
  await fireEvent.changeText(
    screen.getByLabelText('Research question'),
    '  Compare glaze  ',
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Collected sources only' }),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Collected sources and public web' }),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Prefer named authors' }),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Start research' }));
  await waitFor(() =>
    expect(view.router.replace).toHaveBeenCalledWith(`/research/${researchId}`),
  );
  expect(view.commands.mock.calls[0]?.[2].body).toEqual(
    expect.objectContaining({
      instructionZhHant: 'Compare glaze',
      scope: 'curated_and_public_web',
      recordId: collectionRecord.id,
      entryId: null,
      sourceIds: [],
      preferNamedAuthors: false,
    }),
  );
});

it('should preserve the research question when submission fails and allow another attempt', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ entryId: researchId });
  const view = await renderMobile(<NewResearchRoute />, {
    post: async () => {
      throw new Error('Research unavailable');
    },
  });
  await fireEvent.changeText(
    screen.getByLabelText('Research question'),
    'Research a mark',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Start research' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Research unavailable'),
  );
  expect(screen.getByLabelText('Research question')).toHaveDisplayValue(
    'Research a mark',
  );
  expect(view.commands.mock.calls[0]?.[2].body).toEqual(
    expect.objectContaining({
      scope: 'curated_only',
      recordId: null,
      entryId: researchId,
      preferNamedAuthors: true,
    }),
  );
  view.commands.mockResolvedValueOnce({ researchId, jobId: researchId });
  await fireEvent.press(screen.getByRole('button', { name: 'Start research' }));
  await waitFor(() =>
    expect(view.router.replace).toHaveBeenCalledWith(`/research/${researchId}`),
  );
});

it('should keep research submission disabled until the accepted job response arrives', async () => {
  const pending = Promise.withResolvers<unknown>();
  jest.mocked(useLocalSearchParams).mockReturnValue({});
  const view = await renderMobile(<NewResearchRoute />, {
    post: async () => pending.promise,
  });
  await fireEvent.changeText(
    screen.getByLabelText('Research question'),
    'Compare the foot decoration',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Start research' }));
  expect(screen.getByRole('button', { name: 'Processing' })).toBeDisabled();
  expect(view.router.replace).not.toHaveBeenCalled();
  await act(async () => pending.resolve({ researchId, jobId: researchId }));
  await waitFor(() =>
    expect(view.router.replace).toHaveBeenCalledWith(`/research/${researchId}`),
  );
  view.client.clear();
});
