import { expect, it, jest } from '@jest/globals';
import { screen } from '@testing-library/react-native';

import { renderMobile } from '../../../mobile.spec.fixtures';

import { knowledgeEntry } from './knowledge-journey.spec.fixtures';
import { KnowledgeDetailContainer } from './KnowledgeDetailContainer';

jest.mock('../../../providers/AuthProvider', () => ({
  useAuth: jest.fn<typeof import('../../../providers/AuthProvider').useAuth>(),
}));
jest.mock('expo-router', () => ({
  useRouter: jest.fn<typeof import('expo-router').useRouter>(),
  useLocalSearchParams: jest.fn(() => ({ view: 'revision', revision: '3' })),
}));

it('should read the requested historical revision without offering editing', async () => {
  const view = await renderMobile(
    <KnowledgeDetailContainer entryId={knowledgeEntry.id} />,
    { get: async () => knowledgeEntry },
  );

  await screen.findByTestId('knowledge-detail');
  expect(view.reads.mock.calls[0]?.[0]).toContain('view=revision');
  expect(view.reads.mock.calls[0]?.[0]).toContain('revision=3');
  expect(screen.queryByTestId('knowledge-edit')).toBeNull();
  expect(screen.queryByTestId('knowledge-save')).toBeNull();
  expect(view.commands).not.toHaveBeenCalled();
  expect(view.patches).not.toHaveBeenCalled();
});
