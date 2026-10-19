import { expect, it, jest } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react-native';

import {
  knowledgeDetail,
  materialId,
  otherMaterialId,
} from '../features/collection/record-edit.spec.fixtures';
import { renderMobile } from '../mobile.spec.fixtures';

import { ProposalValues } from './ProposalValues';

jest.mock('../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const changeId = '00000000-0000-4000-8000-000000000901';

it('should name the materials a proposed change replaces and proposes', async () => {
  const view = await renderMobile(
    <ProposalValues
      change={{
        id: changeId,
        findingIds: [],
        field: 'materialIds',
        before: [materialId],
        proposed: [materialId, otherMaterialId],
      }}
    />,
    {
      get: async (path) =>
        knowledgeDetail(
          path.slice('/v1/knowledge/'.length),
          path.endsWith(materialId) ? 'Porcelain' : 'Stoneware',
        ),
    },
  );

  await waitFor(() =>
    expect(screen.getByText('Porcelain, Stoneware')).toBeTruthy(),
  );
  expect(screen.getByText('Porcelain')).toBeTruthy();
  // each material is read once, however often it appears
  expect(view.reads).toHaveBeenCalledTimes(2);
});

it('should show other fields as they are, reading nothing', async () => {
  const view = await renderMobile(
    <ProposalValues
      change={{
        id: changeId,
        findingIds: [],
        field: 'name',
        before: 'Bowl',
        proposed: 'Lotus bowl',
      }}
    />,
    {},
  );

  expect(screen.getByText('Bowl')).toBeTruthy();
  expect(screen.getByText('Lotus bowl')).toBeTruthy();
  expect(view.reads).not.toHaveBeenCalled();
});
