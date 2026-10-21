import { expect, it, jest } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react-native';

import { renderMobile } from '../../../../mobile.spec.fixtures';
import {
  knowledgeDetail,
  materialId,
  otherMaterialId,
} from '../../record-edit.spec.fixtures';

import { EditCardRow } from './EditCardRow';

jest.mock('../../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const changeId = '00000000-0000-4000-8000-000000000902';

it('should name the materials an edit card row replaces and proposes', async () => {
  await renderMobile(
    <EditCardRow
      change={{
        id: changeId,
        findingIds: [],
        field: 'materialIds',
        before: [materialId],
        proposed: [otherMaterialId],
      }}
      outcome={undefined}
      decision={undefined}
      onDecide={jest.fn()}
    />,
    {
      get: async (path) =>
        knowledgeDetail(
          path.slice('/v1/knowledge/'.length),
          path.endsWith(materialId) ? 'Rosewood' : 'Huanghuali',
        ),
    },
  );

  await waitFor(() => expect(screen.getByText('Huanghuali')).toBeTruthy());
  expect(screen.getByText('Rosewood')).toBeTruthy();
  expect(screen.queryByText(materialId)).toBeNull();
});
