import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useLocalSearchParams } from 'expo-router';

import { checkDetailSchema, checkPatchSchema } from '@antica/contracts';

import CheckRoute from '../../app/(private)/checks/[checkId]';
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

const checkId = '00000000-0000-4000-8000-000000000031';
const methodId = '00000000-0000-4000-8000-000000000032';
const methodVersionId = '00000000-0000-4000-8000-000000000033';
const checkDetail = checkDetailSchema.parse({
  check: {
    id: checkId,
    revision: 3,
    createdAt: collectionRecord.createdAt,
    updatedAt: collectionRecord.updatedAt,
    recordId: collectionRecord.id,
    componentIds: [],
    methodId,
    methodVersionId,
    suggestedByRunId: null,
    progress: 'not_started',
    result: { kind: 'unrecorded' },
    observationIds: [],
    evidenceAnchorIds: [],
    pendingActionIds: [],
  },
  method: {
    id: methodVersionId,
    methodId,
    revision: 1,
    createdAt: collectionRecord.createdAt,
    definition: {
      titleZhHant: '底部檢查',
      history: [],
      featureEntryIds: [],
      applicability: [],
      observationModes: ['in_person_visual'],
      steps: [
        {
          order: 1,
          actionZhHant: '查看底部',
          evidenceToCaptureZhHant: '記錄款識',
        },
      ],
      interpretationLimits: [],
      exampleReferenceImageIds: [],
      citations: [],
    },
  },
  observations: [],
  evidence: [],
  versions: {
    recordRevision: 7,
    analysisInputVersion: 2,
    evidenceVersion: 4,
  },
  methodUpdateAvailable: true,
});

it('should require a reason for an undetermined check and save the trimmed reason', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ checkId });
  const view = await renderMobile(<CheckRoute />, {
    get: async () => checkDetail,
  });
  await waitFor(() => expect(screen.getByText('Not checked')).toBeTruthy());
  expect(
    screen.getByRole('button', { name: 'Unable to determine' }),
  ).toBeDisabled();
  expect(
    screen.getByText(
      'A newer method is available. This check retains its original method.',
    ),
  ).toBeTruthy();
  await fireEvent.changeText(
    screen.getByLabelText('Reason'),
    '  base obscured  ',
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Unable to determine' }),
  );
  await waitFor(() => expect(view.patches).toHaveBeenCalledTimes(1));

  expect(view.patches.mock.calls[0]).toEqual([
    `/v1/checks/${checkId}`,
    expect.anything(),
    expect.objectContaining({
      body: expect.objectContaining({
        expectedRevision: 3,
        expectedRecordRevision: 7,
        progress: 'recorded',
        result: { kind: 'undetermined', reason: 'base obscured' },
      }),
    }),
  ]);
  const request = checkPatchSchema.parse(view.patches.mock.calls[0][2].body);
  expect(view.patches.mock.calls[0][2].idempotencyKey).toBe(request.requestKey);
});

it('should record presence and offer evidence capture for this check', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ checkId });
  const view = await renderMobile(<CheckRoute />, {
    get: async () => ({
      ...checkDetail,
      methodUpdateAvailable: false,
      observations: [
        {
          id: '00000000-0000-4000-8000-000000000034',
          recordId: collectionRecord.id,
          componentIds: [],
          channel: 'typed',
          text: 'The base is visible',
          evidenceAnchorIds: [],
          checkIds: [checkId],
          observedAt: collectionRecord.createdAt,
          voice: null,
          editDraftId: null,
          supersedesObservationId: null,
          author: 'collector',
          createdAt: collectionRecord.createdAt,
          supersededByObservationId: null,
        },
      ],
    }),
  });
  await waitFor(() => expect(screen.getByText('Not checked')).toBeTruthy());
  expect(screen.getByText('1. 查看底部 — 記錄款識')).toBeTruthy();
  expect(screen.getByText('The base is visible')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Present' }));
  await waitFor(() => expect(view.patches).toHaveBeenCalledTimes(1));
  expect(
    checkPatchSchema.parse(view.patches.mock.calls[0][2].body).result,
  ).toEqual({ kind: 'present' });
  await fireEvent.press(screen.getByRole('button', { name: 'Add evidence' }));
  expect(view.router.push).toHaveBeenCalledWith(
    `/capture?recordId=${collectionRecord.id}&checkId=${checkId}`,
  );
});

it('should show a failed check write and allow an absent retry', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ checkId });
  const view = await renderMobile(<CheckRoute />, {
    get: async () => ({
      ...checkDetail,
      check: {
        ...checkDetail.check,
        result: { kind: 'not_applicable', reason: 'No base' },
      },
    }),
  });
  await waitFor(() => expect(screen.getByText('Not applicable')).toBeTruthy());
  view.patches.mockRejectedValueOnce(new Error('Revision changed'));
  await fireEvent.press(screen.getByRole('button', { name: 'Absent' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Revision changed'),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Absent' }));
  await waitFor(() => expect(view.patches).toHaveBeenCalledTimes(2));
  expect(
    view.patches.mock.calls.map(
      ([, , options]) => checkPatchSchema.parse(options.body).result,
    ),
  ).toEqual([{ kind: 'absent' }, { kind: 'absent' }]);
});

it('should display a recorded undetermined result and retry a read error', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ checkId });
  await renderMobile(<CheckRoute />, {
    get: jest
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue({
        ...checkDetail,
        check: {
          ...checkDetail.check,
          result: { kind: 'undetermined', reason: 'Hidden' },
        },
      }),
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(screen.getAllByText('Unable to determine')).toHaveLength(2),
  );
});

it('should ignore another result while the first check write is pending', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ checkId });
  const view = await renderMobile(<CheckRoute />, {
    get: async () => checkDetail,
  });
  await waitFor(() => expect(screen.getByText('Not checked')).toBeTruthy());
  view.patches.mockImplementationOnce(async () => new Promise(() => undefined));

  await fireEvent.press(screen.getByRole('button', { name: 'Present' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Absent' }));

  expect(view.patches).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Absent' })).toBeDisabled();
});

it('should show a previously recorded absence separately from the result controls', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ checkId });
  const detail = checkDetailSchema.parse({
    ...checkDetail,
    check: {
      ...checkDetail.check,
      progress: 'recorded',
      result: { kind: 'absent' },
    },
  });
  await renderMobile(<CheckRoute />, { get: async () => detail });
  await waitFor(() => expect(screen.getAllByText('Absent')).toHaveLength(2));
  expect(screen.queryByText('Not checked')).toBeNull();
  expect(screen.getByRole('button', { name: 'Present' })).toBeEnabled();
});
