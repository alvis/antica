import { expect, it, jest } from '@jest/globals';
import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen } from '@testing-library/react-native';

import { useState } from 'react';

import { Pressable, Text } from 'react-native';

import { collectionRecord, renderMobile } from '../../../mobile.spec.fixtures';

import { recordEditNoticeQuery } from '../api/record-edit-notice';
import { recordQuery } from '../api/record-query';
import { cabinetId, materialId, receiptId } from '../record-edit.spec.fixtures';

import { useRecordEdit } from './useRecordEdit';
import { useRecordFieldLabels } from './useRecordFieldLabels';

import type { ReactElement } from 'react';

import type { RecordEdit } from './useRecordEdit';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));

/**
 * shows the labels the hook gives three identifiers
 * @returns the labels joined in one text
 */
function LabelProbe(): ReactElement {
  const { labels } = useRecordFieldLabels({
    knowledgeIds: [materialId],
    mediaIds: [receiptId],
  });

  return (
    <Text testID="labels">
      {[
        labels.location(cabinetId),
        labels.knowledge(materialId),
        labels.media(receiptId),
      ].join(' | ')}
    </Text>
  );
}

it('should label identifiers it cannot read with a short identifier', async () => {
  await renderMobile(<LabelProbe />, {
    get: async (path) => {
      if (path === '/v1/locations') {
        return [];
      }
      throw new Error('offline');
    },
  });

  expect(await screen.findByTestId('labels')).toHaveTextContent(
    '00000000 | 00000000 | 00000000',
  );
});

it('should read no notice for a record the editor has not saved', async () => {
  const client = new QueryClient();

  await expect(
    client.fetchQuery({
      ...recordEditNoticeQuery(collectionRecord.id),
      staleTime: 0,
    }),
  ).resolves.toBeNull();
  client.clear();
});

it('should do nothing when asked to apply conflict choices without a conflict', async () => {
  const onLeave = jest.fn();
  let edit: RecordEdit | undefined;
  const EditProbe = (): ReactElement => {
    edit = useRecordEdit(collectionRecord.id, onLeave);

    return <Text testID="edit">{edit.session ? 'ready' : 'loading'}</Text>;
  };
  const view = await renderMobile(<EditProbe />, {
    get: async () => collectionRecord,
  });
  expect(await screen.findByText('ready')).toBeTruthy();

  await act(async () => edit?.resolve());

  expect(view.patches).not.toHaveBeenCalled();
  expect(onLeave).not.toHaveBeenCalled();
  expect(view.router.back).not.toHaveBeenCalled();
});

it('should base the edit on a fresh read even while the cached record is still fresh', async () => {
  const opened = { ...collectionRecord, name: 'Cached bowl' };
  const latest = {
    ...collectionRecord,
    name: 'Latest bowl',
    recordRevision: collectionRecord.recordRevision + 1,
  };
  let served = opened;
  let edit: RecordEdit | undefined;
  const EditProbe = (): ReactElement => {
    edit = useRecordEdit(collectionRecord.id, jest.fn());

    return <Text>{edit.session?.base.name ?? 'loading'}</Text>;
  };
  // the record screen reads the record, then the collector opens the editor
  const Journey = (): ReactElement => {
    const [editing, setEditing] = useState(false);

    return editing ? (
      <EditProbe />
    ) : (
      <Pressable testID="open-editor" onPress={() => setEditing(true)} />
    );
  };
  const view = await renderMobile(<Journey />, {
    get: async () => served,
  });
  // as in the app, a record read moments ago counts as fresh
  view.client.setDefaultOptions({
    queries: {
      retry: false,
      gcTime: Number.POSITIVE_INFINITY,
      staleTime: Number.POSITIVE_INFINITY,
    },
  });
  await act(async () => {
    await view.client.fetchQuery(recordQuery(view.api, collectionRecord.id));
  });
  served = latest;

  await fireEvent.press(screen.getByTestId('open-editor'));

  expect(await screen.findByText('Latest bowl')).toBeTruthy();
  expect(edit?.session?.base.recordRevision).toBe(latest.recordRevision);
});
