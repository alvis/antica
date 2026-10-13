import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useLocalSearchParams } from 'expo-router';

import ResearchDetailRoute from '../../app/(private)/research/[researchId]';
import { renderMobile } from '../../mobile.spec.fixtures';

import {
  researchId,
  sourceId,
  pageId,
  citationId,
  citation,
  detail,
} from './citation.spec.fixtures';

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

it('should open the cited page and preserve its locator when saving edited prose', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ researchId });
  const view = await renderMobile(<ResearchDetailRoute />, {
    get: async () => detail,
  });
  await waitFor(() =>
    expect(screen.getByLabelText('Description 1')).toBeTruthy(),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'View source 10000000' }),
  );
  expect(view.router.push).toHaveBeenCalledWith(
    `/sources/${sourceId}?versionId=${citation.locator.sourceVersionId}&pageId=${pageId}`,
  );
  await fireEvent.changeText(screen.getByLabelText('Name'), 'Collector note');
  await fireEvent.changeText(
    screen.getByLabelText('Description 1'),
    'Edited passage',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));
  await waitFor(() => expect(view.commands).toHaveBeenCalledTimes(1));
  expect(view.commands.mock.calls[0]?.[2].body).toEqual(
    expect.objectContaining({
      researchId,
      expectedDraftRevision: 2,
      titleZhHant: 'Collector note',
      paragraphs: [
        {
          textZhHant: 'Edited passage',
          citationIds: [citationId],
          support: 'cited',
        },
      ],
      citations: [citation],
      recordId: detail.request.recordId,
      entryId: null,
    }),
  );
});

it('should recover from a loading error and keep edited prose after a rejected save', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ researchId });
  const view = await renderMobile(<ResearchDetailRoute />, {
    get: async () => {
      throw new Error('Offline');
    },
  });
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Offline'),
  );
  view.reads.mockResolvedValueOnce(detail);
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Description 1')).toBeTruthy(),
  );
  await fireEvent.changeText(
    screen.getByLabelText('Description 1'),
    'Unsaved collector correction',
  );
  view.commands.mockRejectedValueOnce(new Error('Draft changed'));
  await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Draft changed'),
  );
  expect(screen.getByLabelText('Description 1')).toHaveDisplayValue(
    'Unsaved collector correction',
  );
  expect(view.commands.mock.calls[0]?.[2].body).toEqual(
    expect.objectContaining({
      expectedDraftRevision: 2,
      citations: [citation],
      paragraphs: [
        {
          textZhHant: 'Unsaved collector correction',
          citationIds: [citationId],
          support: 'cited',
        },
      ],
    }),
  );
});
