import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';

import MeRoute from '../../../app/(private)/(tabs)/me';
import { renderMobile } from '../../../mobile.spec.fixtures';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock(
  'expo-router',
  () =>
    ({
      useRouter: jest.fn<typeof import('expo-router').useRouter>(),
    }) satisfies Partial<typeof import('expo-router')>,
);

it('should open research notes from the Me tab, now that research is not a tab', async () => {
  const me = await renderMobile(<MeRoute />, { get: async () => ({}) });

  await fireEvent.press(screen.getByRole('button', { name: 'Research notes' }));

  expect(me.router.push).toHaveBeenCalledWith('/research');
});
