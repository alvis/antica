import { useEffect, useMemo, useRef, useState } from 'react';

import {
  claimRecord,
  discardFile,
  keepFile,
  restoreFiles,
  updateJournal,
} from '../../../adapters/upload-journal';

import type { Dispatch, RefObject, SetStateAction } from 'react';

import type { LocalMedia } from '../../../adapters/media-upload';
import type { JournalScope } from '../../../adapters/upload-journal';

import type { CaptureDraft } from './useCaptureDraft';

/** draft and route context the upload journal follows */
export interface UploadJournalContext {
  draft: CaptureDraft;
  setDraft: Dispatch<SetStateAction<CaptureDraft>>;
  /** restores the record's unfinished files from their journals, as Resume after a restart asks */
  resume: boolean;
  /** whether the collector asked to save, after which unsent files are kept for later */
  attempted: boolean;
  /** signed-in collector whose documents keep the journals; none are kept without one */
  userId: string | null;
}

/**
 * tells whether a draft file gets a journal; voice notes upload at once for transcription
 * @param file draft file
 * @returns true for photos, videos and receipts not yet kept
 */
function needsCopy(file: LocalMedia): boolean {
  return file.copyUri === undefined && file.purpose !== 'voice_note';
}

/** where the draft's journals live, with the record's label for the restart prompt */
interface DraftJournal {
  scope: JournalScope | null;
  label: string;
}

/** refs shared by the journal effects of one capture visit */
interface JournalRefs {
  /** files copied in this visit, which are the only ones a discarded draft deletes */
  kept: RefObject<Set<string>>;
  /** whether the capture screen is still open */
  mounted: RefObject<boolean>;
}

/**
 * finds where the draft's journals live
 * @param userId signed-in collector
 * @param recordId record the draft saves to
 * @returns the collector's record, or null before both are known
 */
function scopeOf(
  userId: string | null,
  recordId: string | undefined,
): JournalScope | null {
  return userId && recordId ? { userId, recordId } : null;
}

/**
 * keeps each new photo, video or receipt in documents once, and records where its copy lives
 * @param context draft and its updater
 * @param refs files kept so far and whether the screen is still open
 * @param journal where the draft's journals live, with the record's label
 */
function useKeepFiles(
  context: Pick<UploadJournalContext, 'draft' | 'setDraft'>,
  refs: JournalRefs,
  journal: DraftJournal,
): void {
  const { draft, setDraft } = context;
  const { kept, mounted } = refs;
  const { scope, label } = journal;
  const userId = scope?.userId;
  const recordId = scope?.recordId;

  useEffect(() => {
    if (!userId || !recordId) {
      return;
    }
    for (const file of draft.files.filter(needsCopy)) {
      if (kept.current.has(file.id)) {
        continue;
      }
      kept.current.add(file.id);
      void keepFile(file, { userId, recordId, label }).then((copy) => {
        if (!mounted.current) {
          // the draft closed while the copy was made, so nothing will upload it
          discardFile({ userId, recordId }, file.id);

          return;
        }
        setDraft((current) => ({
          ...current,
          files: current.files.map((item) =>
            item.id === file.id
              ? { ...item, copyUri: copy?.copyUri ?? null }
              : item,
          ),
        }));
      });
    }
  }, [draft.files, userId, recordId, label, setDraft, kept, mounted]);
}

/**
 * mirrors the collector's edits and each upload state into the journals, dropping the journal of
 * a file that finished uploading
 * @param draft current capture draft
 * @param journal where the draft's journals live, with the record's label
 */
function useSyncJournals(draft: CaptureDraft, journal: DraftJournal): void {
  const { scope, label: recordLabel } = journal;
  const userId = scope?.userId;
  const recordId = scope?.recordId;
  const written = useRef(new Map<string, string>());

  useEffect(() => {
    if (!userId || !recordId) {
      return;
    }
    for (const file of draft.files) {
      if (!file.copyUri) {
        continue;
      }
      const fields = {
        recordLabel,
        componentLabel: file.componentLabel,
        excluded: file.excluded === true,
        state: file.state,
        lastErrorCode: file.errorCode ?? null,
      };
      const signature = JSON.stringify(fields);
      if (written.current.get(file.id) === signature) {
        continue;
      }
      written.current.set(file.id, signature);
      // an upload completed without the journal, as one begun before its copy existed, leaves
      // nothing to resume
      if (file.state === 'uploaded') {
        discardFile({ userId, recordId }, file.id);
      } else {
        updateJournal({ userId, recordId }, file.id, fields);
      }
    }
  }, [draft.files, userId, recordId, recordLabel]);
}

/**
 * deletes the copies kept in this visit when the screen closes before saving was ever asked for
 * @param context draft and whether saving was asked for
 * @param refs files kept in this visit and whether the screen is still open
 */
function useDiscardUnsaved(
  context: Pick<UploadJournalContext, 'draft' | 'attempted'> & {
    scope: JournalScope | null;
  },
  refs: JournalRefs,
): void {
  const { draft, attempted, scope } = context;
  const { kept, mounted } = refs;
  const latest = useRef({ files: draft.files, scope, attempted });

  useEffect(() => {
    latest.current = { files: draft.files, scope, attempted };
  }, [draft.files, scope, attempted]);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      const { files, scope: closed, attempted: saved } = latest.current;
      if (!closed || saved) {
        return;
      }
      for (const file of files) {
        if (kept.current.has(file.id) && file.state === 'local') {
          discardFile(closed, file.id);
        }
      }
    };
  }, [kept, mounted]);
}

/**
 * keeps every new draft file in the documents directory with an upload journal, mirrors the
 * collector's edits into it, restores a record's unfinished files when resuming, and deletes the
 * copies of a draft discarded before it was ever saved
 * @param context draft, its updater, and whether to resume
 * @param context.draft current capture draft
 * @param context.setDraft capture draft updater
 * @param context.resume restores unfinished files of the draft's record
 * @param context.attempted whether saving was asked for
 * @param context.userId signed-in collector whose documents keep the journals
 * @returns the files restored for uploading, or null until restoring has run
 */
export function useUploadJournal({
  draft,
  setDraft,
  resume,
  attempted,
  userId,
}: UploadJournalContext): string[] | null {
  const record = draft.record;
  const recordId = record?.id;
  const scope = useMemo(() => scopeOf(userId, recordId), [userId, recordId]);
  const journal: DraftJournal = {
    scope,
    label: record ? (record.name ?? record.code) : '',
  };
  const [restored, setRestored] = useState<string[] | null>(null);
  const refs: JournalRefs = {
    kept: useRef(new Set<string>()),
    mounted: useRef(true),
  };

  useEffect(() => (recordId ? claimRecord(recordId) : undefined), [recordId]);
  useKeepFiles({ draft, setDraft }, refs, journal);
  useSyncJournals(draft, journal);

  useEffect(() => {
    if (!resume || !scope || restored !== null) {
      return;
    }
    const files = restoreFiles(scope);
    // restoring runs once the record loads, before the collector can add files of their own
    setDraft((current) => ({
      ...current,
      files: [...current.files, ...files],
    }));
    setRestored(files.filter((file) => !file.excluded).map((file) => file.id));
  }, [resume, scope, restored, setDraft]);

  useDiscardUnsaved({ draft, attempted, scope }, refs);

  return restored;
}
