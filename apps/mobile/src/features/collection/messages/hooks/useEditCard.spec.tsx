import { describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';

import { collectionRecord } from '../../../../mobile.spec.fixtures';

import {
  entry,
  nameChange,
  nameChangeId,
  periodChange,
  periodChangeId,
  recordId,
} from '../containers/record-messages.spec.fixtures';

import { useEditCard } from './useEditCard';
import { useEditCardStates } from './useEditCardStates';

import type { RenderHookResult } from '@testing-library/react-native';

import type { FC, PropsWithChildren } from 'react';

import type { ApiTransport } from '@antica/client';
import type { RecordDetail, RecordMessageDraft } from '@antica/contracts';

interface ShownRecord {
  record: RecordDetail | undefined;
}

jest.mock('../../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'key' }));

/**
 * renders the edit-card rule over one reply with its lifted state
 * @param draft overrides of the reply's draft
 * @returns the hook harness
 */
async function renderEditCard(
  draft: Partial<RecordMessageDraft> = {},
): Promise<RenderHookResult<ReturnType<typeof useEditCard>, ShownRecord>> {
  const reply = entry('assistant', 'Changes', {
    proposedChanges: [nameChange, periodChange],
    ...draft,
  });
  const client = new QueryClient();
  const wrapper: FC<PropsWithChildren> = ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  return renderHook(
    ({ record }: ShownRecord) => {
      const states = useEditCardStates();

      return useEditCard({
        api: {} as ApiTransport,
        recordId,
        entry: reply,
        record,
        state: states.stateOf(reply.editDraftId),
        update: states.updaterOf(reply.editDraftId),
        t: (key) => key,
      });
    },
    { wrapper, initialProps: { record: collectionRecord } },
  );
}

describe('fn:useEditCard', () => {
  it('should offer no apply until every open row is decided', async () => {
    const { result } = await renderEditCard();

    expect(result.current.apply).toBeUndefined();
    expect(result.current.undecidedIds).toEqual([nameChangeId, periodChangeId]);

    await act(async () => result.current.decide(nameChangeId, 'confirmed'));
    expect(result.current.apply).toBeUndefined();

    await act(async () => result.current.decide(periodChangeId, 'rejected'));
    expect(result.current.apply).toBeInstanceOf(Function);
    expect(result.current.confirmedIds).toEqual([nameChangeId]);
    expect(result.current.rejectedIds).toEqual([periodChangeId]);
  });

  it('should clear a decision on undo and withdraw the apply again', async () => {
    const { result } = await renderEditCard();
    await act(async () => result.current.decide(nameChangeId, 'confirmed'));
    await act(async () => result.current.decide(periodChangeId, 'confirmed'));

    await act(async () => result.current.decide(nameChangeId, undefined));

    expect(result.current.decisions[nameChangeId]).toBeUndefined();
    expect(result.current.confirmedIds).toEqual([periodChangeId]);
    expect(result.current.undecidedIds).toEqual([nameChangeId]);
    expect(result.current.apply).toBeUndefined();
  });

  it('should need decisions only on rows the server has not settled', async () => {
    const { result } = await renderEditCard({
      status: 'partially_applied',
      appliedProposalIds: [nameChangeId],
    });

    expect(result.current.undecidedIds).toEqual([periodChangeId]);
    await act(async () => result.current.decide(periodChangeId, 'rejected'));
    expect(result.current.apply).toBeInstanceOf(Function);
  });

  it('should offer no apply once every row is settled', async () => {
    const { result } = await renderEditCard({
      status: 'applied',
      appliedProposalIds: [nameChangeId],
      skippedProposalIds: [periodChangeId],
    });

    expect(result.current.undecidedIds).toEqual([]);
    expect(result.current.apply).toBeUndefined();
  });
});

describe('Record changes', () => {
  it('should block a confirmed row whose current field changes and still allow rejecting it', async () => {
    const { result, rerender } = await renderEditCard();
    await act(async () => result.current.decide(nameChangeId, 'confirmed'));
    await act(async () => result.current.decide(periodChangeId, 'rejected'));
    expect(result.current.apply).toBeInstanceOf(Function);

    await rerender({
      record: {
        ...collectionRecord,
        name: 'Saved elsewhere',
        recordRevision: 2,
      },
    });

    expect(result.current.staleIds).toEqual([nameChangeId]);
    expect(result.current.apply).toBeUndefined();
    await act(async () => result.current.decide(nameChangeId, 'rejected'));
    expect(result.current.confirmedIds).toEqual([]);
    expect(result.current.rejectedIds).toEqual([nameChangeId, periodChangeId]);
    expect(result.current.apply).toBeInstanceOf(Function);
  });

  it('should leave unchanged fields applicable when another field changes the record revision', async () => {
    const { result, rerender } = await renderEditCard();
    await act(async () => result.current.decide(nameChangeId, 'confirmed'));
    await act(async () => result.current.decide(periodChangeId, 'rejected'));

    await rerender({
      record: {
        ...collectionRecord,
        description: 'Edited elsewhere',
        recordRevision: 2,
      },
    });

    expect(result.current.staleIds).toEqual([]);
    expect(result.current.apply).toBeInstanceOf(Function);
  });
});
