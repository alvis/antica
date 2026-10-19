import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';

import { Keyboard } from 'react-native';

import { useAuth } from '../../../providers/AuthProvider';
import { useLocale } from '../../../providers/LocaleProvider';

import { setRecordEditNotice } from '../api/record-edit-notice';
import { recordQuery } from '../api/record-query';
import { describeMessageError } from '../messages/api/message-errors';
import { draftFromRecord } from '../record-edit-draft';
import { changedFields, fieldErrors, rebaseDraft } from '../record-edit-patch';

import { useRecordEditSave } from './useRecordEditSave';

import type { UseQueryResult } from '@tanstack/react-query';

import type { Dispatch, SetStateAction } from 'react';

import type { RecordDetail } from '@antica/contracts';

import type { PlainMessageKey } from '../../../i18n/messages';

import type { RecordEditDraft, RecordEditField } from '../record-edit-draft';

import type {
  RecordEditConflict,
  RecordEditSession,
  SaveOutcome,
} from './useRecordEditSave';

/** the collector's choice for a field in conflict */
export type ConflictChoice = 'mine' | 'current';

/** a conflict waiting for the collector's choices */
export type PendingConflict = RecordEditConflict & {
  readonly choices: Partial<Record<RecordEditField, ConflictChoice>>;
};

/** the editor's state and operations */
export type RecordEdit = {
  readonly record: UseQueryResult<RecordDetail>;
  readonly session: RecordEditSession | null;
  /** fields changed since editing started or was last refreshed */
  readonly changed: readonly RecordEditField[];
  /** validation errors, shown once the collector tried to save */
  readonly errors: Partial<Record<RecordEditField, PlainMessageKey>>;
  readonly conflict: PendingConflict | null;
  /** translated save failure, or empty */
  readonly failure: string;
  /** set when the record changed again during the automatic re-send */
  readonly changedAgain: boolean;
  /** set while a save runs; the form is read-only meanwhile so nothing typed is lost */
  readonly saving: boolean;
  /** changes the form; ignored while a save runs */
  readonly update: (patch: Partial<RecordEditDraft>) => void;
  readonly save: () => Promise<void>;
  readonly choose: (field: RecordEditField, choice: ConflictChoice) => void;
  readonly resolve: () => Promise<void>;
};

/** how a save attempt left the editor: a conflict to resolve, or a message to show */
type SaveFeedback = {
  readonly conflict: PendingConflict | null;
  readonly failure: string;
  readonly changedAgain: boolean;
  /** clears the messages of the previous attempt */
  readonly reset: () => void;
  readonly settle: (outcome: SaveOutcome) => Promise<void>;
  readonly choose: RecordEdit['choose'];
  readonly dismissConflict: () => void;
};

/**
 * closes the editor after a save: the saved record replaces the cached one,
 * the record screen learns whether the save landed on a refreshed record, and
 * the record and its history are read again
 * @param recordId record being edited
 * @param onLeave called just before the editor closes, so a leave guard stands down
 * @returns a close that takes the saved record, or nothing when no save was needed
 */
function useRecordEditClose(
  recordId: string,
  onLeave: () => void,
): (saved?: RecordDetail, refreshed?: boolean) => Promise<void> {
  const { api } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  return async (saved, refreshed = false) => {
    onLeave();
    if (saved) {
      queryClient.setQueryData(recordQuery(api, recordId).queryKey, saved);
      setRecordEditNotice(
        queryClient,
        recordId,
        refreshed ? 'refreshed' : null,
      );
    }
    router.back();
    if (saved) {
      // the history sits beneath the record key, so this refreshes it too
      await queryClient.invalidateQueries({ queryKey: ['record', recordId] });
      await queryClient.invalidateQueries({ queryKey: ['records'] });
    }
  };
}

/**
 * keeps what the last save attempt left for the collector to see or decide
 * @param close closes the editor after a successful save
 * @returns the pending conflict, the messages, and their handlers
 */
function useSaveFeedback(
  close: (saved: RecordDetail, refreshed: boolean) => Promise<void>,
): SaveFeedback {
  const { t } = useLocale();
  const [conflict, setConflict] = useState<PendingConflict | null>(null);
  const [failure, setFailure] = useState('');
  const [changedAgain, setChangedAgain] = useState(false);

  return {
    conflict,
    failure,
    changedAgain,
    reset: () => {
      setFailure('');
      setChangedAgain(false);
    },
    settle: async (outcome) => {
      if (outcome.kind === 'saved') {
        await close(outcome.record, outcome.refreshed);
      } else if (outcome.kind === 'conflict') {
        setConflict({ ...outcome.conflict, choices: {} });
      } else if (outcome.kind === 'changedAgain') {
        setChangedAgain(true);
      } else {
        setFailure(describeMessageError(outcome.cause, t));
      }
    },
    choose: (field, choice) =>
      setConflict(
        (current) =>
          current && {
            ...current,
            choices: { ...current.choices, [field]: choice },
          },
      ),
    dismissConflict: () => setConflict(null),
  };
}

/** the edit session, the fields changed since its base, and how the form changes */
type EditSession = {
  readonly session: RecordEditSession | null;
  readonly setSession: Dispatch<SetStateAction<RecordEditSession | null>>;
  readonly changed: RecordEditField[];
  readonly update: RecordEdit['update'];
};

/**
 * holds the edit session: its base is fixed once the record has been read
 * since the editor opened, so a cached copy never becomes the base, and later
 * reads of the record never move it
 * @param record record as read since the editor opened, or nothing yet
 * @param locked set while a save runs, when the form takes no changes
 * @returns the session, its setter, the fields changed since its base, and the form update
 */
function useEditSession(
  record: RecordDetail | undefined,
  locked: boolean,
): EditSession {
  const [session, setSession] = useState<RecordEditSession | null>(null);
  if (!session && record) {
    setSession({ base: record, draft: draftFromRecord(record) });
  }
  const base = session?.base;
  const baseDraft = useMemo(() => base && draftFromRecord(base), [base]);

  return {
    session,
    setSession,
    changed:
      session && baseDraft ? changedFields(baseDraft, session.draft) : [],
    update: (patch) => {
      if (!locked) {
        setSession(
          (current) =>
            current && { ...current, draft: { ...current.draft, ...patch } },
        );
      }
    },
  };
}

/**
 * reads the record for an edit; the edit's base must come from a read made for
 * it, so a cached copy is read again even while it still counts as fresh
 * @param recordId record to edit
 * @returns the record read
 */
function useFreshRecord(recordId: string): UseQueryResult<RecordDetail> {
  const { api } = useAuth();

  return useQuery({ ...recordQuery(api, recordId), refetchOnMount: 'always' });
}

/**
 * edits one record by hand: tracks the base record and the form, saves the
 * changed fields only, and turns revision conflicts into per-field choices
 * @param recordId record to edit
 * @param onLeave called just before the editor closes after saving, so a leave guard stands down
 * @returns editor state and operations
 */
export function useRecordEdit(
  recordId: string,
  onLeave: () => void,
): RecordEdit {
  const record = useFreshRecord(recordId);
  const saver = useRecordEditSave(recordId);
  const { session, setSession, changed, update } = useEditSession(
    record.isFetchedAfterMount ? record.data : undefined,
    saver.saving,
  );
  const [submitted, setSubmitted] = useState(false);
  const close = useRecordEditClose(recordId, onLeave);
  const feedback = useSaveFeedback(close);
  const { conflict } = feedback;

  return {
    record,
    session,
    changed,
    errors: session && submitted ? fieldErrors(session.draft, changed) : {},
    conflict,
    failure: feedback.failure,
    changedAgain: feedback.changedAgain,
    saving: saver.saving,
    update,
    save: async () => {
      // the form is read-only while saving, so the keyboard goes too
      Keyboard.dismiss();
      setSubmitted(true);
      feedback.reset();
      if (!session || Object.keys(fieldErrors(session.draft, changed)).length) {
        return;
      }
      await (changed.length
        ? feedback.settle(await saver.save(session, setSession))
        : close());
    },
    choose: feedback.choose,
    resolve: async () => {
      if (!session || !conflict) {
        return;
      }
      const latestDraft = draftFromRecord(conflict.latest);
      const kept = changed.filter(
        (field) => conflict.choices[field] !== 'current',
      );
      const next = {
        base: conflict.latest,
        draft: rebaseDraft(session.draft, latestDraft, kept),
      };
      Keyboard.dismiss();
      setSession(next);
      feedback.dismissConflict();
      feedback.reset();
      await (changedFields(latestDraft, next.draft).length
        ? feedback.settle(await saver.save(next, setSession))
        : close(conflict.latest, false));
    },
  };
}
