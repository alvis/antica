import { useQuery, useQueryClient } from '@tanstack/react-query';

import { randomUUID } from 'expo-crypto';
import { useRef, useState } from 'react';

import { ApiError } from '@antica/client';
import {
  knowledgeEntryDetailV2Schema,
  knowledgeReadV2Schema,
  knowledgeUpdateV2Schema,
} from '@antica/contracts';

import { useAuth } from '../../../providers/AuthProvider';
import { useLocale } from '../../../providers/LocaleProvider';

import { knowledgeReviewBody } from '../api/knowledgeReview';

import type {
  FetchQueryOptions,
  QueryFunctionContext,
  UseQueryResult,
} from '@tanstack/react-query';

import type { Dispatch, SetStateAction } from 'react';

import type { KnowledgeEntryDetailV2 } from '@antica/contracts';

/** editor state survives a failed save or revision conflict */
export interface KnowledgeEditor {
  editing: boolean;
  title: string | null;
  summary: string | null;
  status: 'idle' | 'busy' | 'error' | 'conflict' | 'success';
}
const initialEditor: KnowledgeEditor = {
  editing: false,
  title: null,
  summary: null,
  status: 'idle',
};

interface KnowledgeEntryState {
  detail: UseQueryResult<KnowledgeEntryDetailV2, Error>;
  editor: KnowledgeEditor;
  setEditor: Dispatch<SetStateAction<KnowledgeEditor>>;
  save: () => Promise<void>;
  reload: () => Promise<void>;
}
const revisionConflictStatus = 409;
/**
 * reads explicitly selected revisions and saves only after collector action
 * @param entryId owner-scoped entry identity
 * @param view saved, working or explicitly pinned historical revision
 * @param revision immutable revision required by historical reads
 * @returns reading query, retained form, and explicit save controls
 */
export function useKnowledgeEntry(
  entryId: string,
  view: 'saved' | 'working' | 'revision',
  revision?: number,
): KnowledgeEntryState {
  const { api, userId } = useAuth();
  const { locale } = useLocale();
  const [editor, setEditor] = useState(initialEditor);
  const [readView, setReadView] = useState(view);
  const client = useQueryClient();
  const queryOptions = (
    selectedView: typeof view,
  ): FetchQueryOptions<KnowledgeEntryDetailV2, Error> => ({
    queryKey: [
      'knowledge-detail',
      userId,
      entryId,
      selectedView,
      locale,
      revision,
    ],
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const read = knowledgeReadV2Schema.parse({
        view: selectedView,
        locale,
        revision: selectedView === 'revision' ? revision : undefined,
      });
      const parameters = new URLSearchParams({ view: selectedView, locale });
      if (read.revision !== undefined) {
        parameters.set('revision', String(read.revision));
      }

      return api.get(
        `/v1/knowledge/${entryId}?${parameters}`,
        knowledgeEntryDetailV2Schema,
        signal,
      );
    },
  });
  const detail = useQuery(queryOptions(readView));
  const reload = async (): Promise<void> => {
    if (view === 'revision') {
      return;
    }
    try {
      await client.fetchQuery({ ...queryOptions('working'), staleTime: 0 });
      setReadView('working');
      setEditor((previous) => ({ ...previous, status: 'idle' }));
    } catch {
      setEditor((previous) => ({ ...previous, status: 'conflict' }));
    }
  };
  const save = useKnowledgeSave({
    entry: view === 'revision' ? undefined : detail.data,
    editor,
    setEditor,
    entryId,
  });

  return { detail, editor, setEditor, save, reload };
}

/**
 * retains idempotency across retries and prevents concurrent save taps
 * @param context current revision and retained editor
 * @param context.entry owner-scoped evidence snapshot
 * @param context.editor retained title, summary and operation status
 * @param context.setEditor changes the retained operation state
 * @param context.entryId identity used by the update endpoint
 * @returns explicit asynchronous review action
 */
function useKnowledgeSave({
  entry,
  editor,
  setEditor,
  entryId,
}: Pick<KnowledgeEntryState, 'editor' | 'setEditor'> & {
  entry: KnowledgeEntryDetailV2 | undefined;
  entryId: string;
}): () => Promise<void> {
  const { api } = useAuth();
  const client = useQueryClient();
  const sending = useRef(false);
  const requestIdentity = useRef<{ fingerprint: string; key: string } | null>(
    null,
  );

  return async (): Promise<void> => {
    if (!entry || sending.current) {
      return;
    }
    sending.current = true;
    setEditor((previous) => ({ ...previous, status: 'busy' }));
    try {
      const body = knowledgeReviewBody(entry, editor);
      const fingerprint = JSON.stringify(body);
      if (requestIdentity.current?.fingerprint !== fingerprint) {
        requestIdentity.current = { fingerprint, key: randomUUID() };
      }
      const request = knowledgeUpdateV2Schema.parse({
        ...body,
        requestKey: requestIdentity.current.key,
      });
      await api.patch(
        `/v1/knowledge/${entryId}`,
        knowledgeEntryDetailV2Schema,
        { body: request, idempotencyKey: request.requestKey },
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: ['knowledge-detail'] }),
        client.invalidateQueries({ queryKey: ['knowledge-search'] }),
      ]);
      setEditor({ ...initialEditor, status: 'success' });
      requestIdentity.current = null;
    } catch (cause) {
      setEditor((previous) => ({
        ...previous,
        status:
          cause instanceof ApiError &&
          (cause.status === revisionConflictStatus ||
            cause.code === 'REVISION_CONFLICT')
            ? 'conflict'
            : 'error',
      }));
    } finally {
      sending.current = false;
    }
  };
}
