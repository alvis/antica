import { expect, it, jest } from '@jest/globals';
import { act, waitFor } from '@testing-library/react-native';

import { ApiError } from '@antica/client';

import { renderMobile } from '../../../mobile.spec.fixtures';

import { knowledgeEntry } from '../containers/knowledge-journey.spec.fixtures';

import { useKnowledgeEntry } from './useKnowledgeEntry';

import type { KnowledgeEntryDetailV2 } from '@antica/contracts';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));

let current: ReturnType<typeof useKnowledgeEntry>;

/**
 * exposes the live hook through the standard authenticated mobile harness
 * @param props selected revision
 * @param props.view saved or working revision
 * @param props.revision optional pinned revision from the route
 * @returns no visual content
 */
const EntryProbe = ({
  view = 'saved',
  revision,
}: {
  view?: 'saved' | 'working' | 'revision';
  revision?: number;
}): null => {
  current = useKnowledgeEntry(knowledgeEntry.id, view, revision);

  return null;
};

it('should ignore save while the selected revision is still loading', async () => {
  const view = await renderMobile(<EntryProbe />, {
    get: async () => new Promise(() => undefined),
  });

  await act(async () => current.save());
  expect(view.patches).not.toHaveBeenCalled();
  expect(current.editor.status).toBe('idle');
});

it('should serialize double save taps until the first review completes', async () => {
  let finishPatch!: (entry: KnowledgeEntryDetailV2) => void;
  const pending = new Promise<KnowledgeEntryDetailV2>((resolve) => {
    finishPatch = resolve;
  });
  const view = await renderMobile(<EntryProbe />, {
    get: async () => knowledgeEntry,
    patch: async () => pending,
  });
  await waitFor(() => expect(current.detail.data).toEqual(knowledgeEntry));
  let firstSave!: Promise<void>;
  await act(() => {
    firstSave = current.save();
    void current.save();
  });

  expect(current.editor.status).toBe('busy');
  expect(view.patches).toHaveBeenCalledTimes(1);
  await act(async () => {
    finishPatch(knowledgeEntry);
    await firstSave;
  });
  expect(current.editor.status).toBe('success');
});

it('should recognize a revision conflict code even when the HTTP status differs', async () => {
  await renderMobile(<EntryProbe view="working" />, {
    get: async () => knowledgeEntry,
    patch: async () => {
      throw new ApiError({
        status: 400,
        code: 'REVISION_CONFLICT',
        message: 'Changed',
      });
    },
  });
  await waitFor(() => expect(current.detail.data).toEqual(knowledgeEntry));
  await act(() =>
    current.setEditor((previous) => ({ ...previous, title: 'Retained title' })),
  );
  await act(async () => current.save());

  expect(current.editor.status).toBe('conflict');
  expect(current.editor.title).toBe('Retained title');
});

it('should read the requested historical revision without saving or replacing it with working content', async () => {
  const view = await renderMobile(<EntryProbe view="revision" revision={3} />, {
    get: async () => knowledgeEntry,
  });
  await waitFor(() => expect(current.detail.data).toEqual(knowledgeEntry));

  expect(view.reads).toHaveBeenCalledWith(
    `/v1/knowledge/${knowledgeEntry.id}?view=revision&locale=en&revision=3`,
    expect.anything(),
    expect.anything(),
  );
  await act(async () => current.save());
  await act(async () => current.reload());
  expect(view.patches).not.toHaveBeenCalled();
  expect(
    view.reads.mock.calls.every(([path]) => path.includes('view=revision')),
  ).toBe(true);
});
