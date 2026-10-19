import { useQueryClient } from '@tanstack/react-query';

import { randomUUID } from 'expo-crypto';

import { useRef, useState } from 'react';

import { recordDetailSchema } from '@antica/contracts';

import { useAuth } from '../../../providers/AuthProvider';

import { recordQuery } from '../api/record-query';
import { isRevisionConflict } from '../messages/api/message-errors';
import { draftFromRecord } from '../record-edit-draft';
import {
  changedFields,
  conflictingFields,
  patchFields,
  rebaseDraft,
} from '../record-edit-patch';

import type { RecordDetail } from '@antica/contracts';

import type { RecordEditDraft, RecordEditField } from '../record-edit-draft';

/** the record an edit is based on and the form state built on it */
export type RecordEditSession = {
  /** record as the server last returned it; its revision is sent as expectedRevision */
  readonly base: RecordDetail;
  readonly draft: RecordEditDraft;
};

/** changed fields that the server also changed, waiting for the collector's choice */
export type RecordEditConflict = {
  readonly latest: RecordDetail;
  readonly fields: readonly RecordEditField[];
};

/** how one save attempt ended */
export type SaveOutcome =
  | {
      readonly kind: 'saved';
      readonly record: RecordDetail;
      readonly refreshed: boolean;
    }
  | { readonly kind: 'conflict'; readonly conflict: RecordEditConflict }
  | { readonly kind: 'changedAgain'; readonly session: RecordEditSession }
  | { readonly kind: 'failed'; readonly cause: unknown };

/** state and operations of the editor's save */
export type RecordEditSave = {
  readonly saving: boolean;
  /**
   * sends the changed fields against the session's revision; on a conflict it
   * refetches, sends once more by itself when none of the changed fields moved,
   * and otherwise reports the fields that need the collector's choice
   */
  readonly save: (
    session: RecordEditSession,
    onRebase: (session: RecordEditSession) => void,
  ) => Promise<SaveOutcome>;
};

/**
 * the requests a save makes: the PATCH of the changed fields, and the read of
 * the latest record after the server refused a stale revision
 * @param recordId record being edited
 * @returns the PATCH, and a read that never reuses an earlier or stale answer
 */
function useRecordRequests(recordId: string): {
  send: (session: RecordEditSession) => Promise<RecordDetail>;
  readLatest: (base: RecordDetail) => Promise<RecordDetail>;
} {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  // the same request body is retried under the same key, so a lost reply cannot apply it twice
  const lastRequest = useRef<{ body: string; key: string } | null>(null);

  const readFresh = async (): Promise<RecordDetail> => {
    const query = recordQuery(api, recordId);
    // a read already in flight may have started before the conflicting write, so it is replaced, never joined
    await queryClient.cancelQueries({ queryKey: query.queryKey, exact: true });

    return queryClient.fetchQuery({ ...query, staleTime: 0 });
  };

  return {
    send: async (session) => {
      const fields = changedFields(
        draftFromRecord(session.base),
        session.draft,
      );
      const body = {
        expectedRevision: session.base.recordRevision,
        fields: patchFields(session.base, session.draft, fields),
      };
      const serialized = JSON.stringify(body);
      if (lastRequest.current?.body !== serialized) {
        lastRequest.current = { body: serialized, key: randomUUID() };
      }

      return api.patch(
        `/v1/records/${encodeURIComponent(recordId)}`,
        recordDetailSchema,
        { body, idempotencyKey: lastRequest.current.key },
      );
    },
    readLatest: async (base) => {
      const latest = await readFresh();

      // the server refused the base revision, so a read no newer than it is stale: read once more
      return latest.recordRevision > base.recordRevision ? latest : readFresh();
    },
  };
}

/**
 * saves manual record edits without ever overwriting a field another writer changed
 * @param recordId record being edited
 * @returns whether a save is running, and the save operation
 */
export function useRecordEditSave(recordId: string): RecordEditSave {
  const [saving, setSaving] = useState(false);
  const { send, readLatest } = useRecordRequests(recordId);

  const attempt = async (
    session: RecordEditSession,
    onRebase: (session: RecordEditSession) => void,
    retried: boolean,
  ): Promise<SaveOutcome> => {
    try {
      return { kind: 'saved', record: await send(session), refreshed: retried };
    } catch (cause) {
      if (!isRevisionConflict(cause)) {
        return { kind: 'failed', cause };
      }
      const latest = await readLatest(session.base);
      const next = resolveConflict(session, latest);
      if ('conflict' in next) {
        return { kind: 'conflict', conflict: next.conflict };
      }
      if (!changedFields(draftFromRecord(latest), next.session.draft).length) {
        // the server already holds every edit, as when an earlier reply was lost after the save landed
        return { kind: 'saved', record: latest, refreshed: false };
      }
      onRebase(next.session);

      return retried
        ? { kind: 'changedAgain', session: next.session }
        : attempt(next.session, onRebase, true);
    }
  };

  return {
    saving,
    save: async (session, onRebase) => {
      setSaving(true);
      try {
        return await attempt(session, onRebase, false);
      } catch (cause) {
        return { kind: 'failed', cause };
      } finally {
        setSaving(false);
      }
    },
  };
}

/**
 * decides what a revision conflict means for this edit: either nothing the
 * collector changed moved on the server to another value, so the edit moves onto
 * the latest record, or some changed fields did and need the collector's choice
 * @param session edit that met the conflict
 * @param latest record as the server now holds it
 * @returns the edit moved onto the latest record, or the fields in conflict
 */
export function resolveConflict(
  session: RecordEditSession,
  latest: RecordDetail,
): { session: RecordEditSession } | { conflict: RecordEditConflict } {
  const baseDraft = draftFromRecord(session.base);
  const latestDraft = draftFromRecord(latest);
  const changed = changedFields(baseDraft, session.draft);
  const fields = conflictingFields(
    { base: baseDraft, latest: latestDraft, draft: session.draft },
    changed,
  );
  if (fields.length) {
    return { conflict: { latest, fields } };
  }

  return {
    session: {
      base: latest,
      draft: rebaseDraft(session.draft, latestDraft, changed),
    },
  };
}
