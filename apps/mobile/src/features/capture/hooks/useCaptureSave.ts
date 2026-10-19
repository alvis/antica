import { randomUUID } from 'expo-crypto';
import { useState } from 'react';

import {
  evidenceAnchorSchema,
  locationSchema,
  mediaDetailSchema,
  recordDetailSchema,
  recordPatchSchema,
} from '@antica/contracts';

import { componentLabelsOf } from '../capture-grid';
import { openSavedRecord } from '../open-saved-record';
import {
  patchFile,
  uploadDraftFile,
  withKeptCopies,
} from '../upload-draft-file';

import { describeActionLinkError } from './useActionLink';

import type { QueryClient } from '@tanstack/react-query';

import type { useRouter } from 'expo-router';

import type { Location } from '@antica/contracts';

import type { DraftUploadContext } from '../upload-draft-file';

import type { ActionLink } from './useActionLink';
import type { CaptureDraftState, CaptureRuntime } from './useCaptureDraft';

/** per-file upload errors, the save action, and retries of files that did not upload */
export interface CaptureSave {
  fileErrors: Record<string, string>;
  /** whether the collector asked to save, after which unsent files are kept for later */
  attempted: boolean;
  save: () => Promise<void>;
  /** uploads the given failed files again, sending only what storage lacks */
  retry: (fileIds: readonly string[]) => Promise<void>;
  /**
   * uploads files restored after a restart without saving the record's fields again, then opens
   * the record once every one uploaded
   */
  resume: (fileIds: readonly string[]) => Promise<void>;
}

/**
 * saves the record fields, uploads pending media, links check evidence, and opens the record
 * @param runtime API transport, translations, and shared busy/error status
 * @param context draft state, route context, and saved locations
 * @param context.draft record, media, and words collected so far
 * @param context.editedFields fields the collector edited
 * @param context.setStep capture step updater
 * @param context.setDraft capture draft updater
 * @param context.update capture draft patcher
 * @param context.userId signed-in collector whose documents keep the journals
 * @param context.savedObservation whether the original words were confirmed
 * @param context.locations the collector's saved storage locations
 * @param context.checkId check the capture answers, when opened from one
 * @param context.actionLink analysis action the capture answers, when opened from one
 * @param context.queryClient query cache to refresh after saving
 * @param context.router navigator used to open the saved record
 * @returns per-file errors and the save action
 */
export function useCaptureSave(
  runtime: CaptureRuntime,
  {
    draft,
    editedFields,
    setStep,
    setDraft,
    update,
    userId,
    savedObservation,
    locations,
    checkId,
    actionLink,
    queryClient,
    router,
  }: Pick<
    CaptureDraftState,
    'draft' | 'editedFields' | 'setStep' | 'setDraft' | 'update'
  > & {
    userId: string | null;
    savedObservation: boolean;
    locations: Location[] | undefined;
    checkId: string | undefined;
    actionLink: Pick<ActionLink, 'linked' | 'verify' | 'supply'>;
    queryClient: QueryClient;
    router: ReturnType<typeof useRouter>;
  },
): CaptureSave {
  const { api, t, busy, setBusy, setError } = runtime;
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const [savedFields, setSavedFields] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const uploads: DraftUploadContext = {
    api,
    t,
    userId,
    publish: (fileId, patch) =>
      setDraft((current) => ({
        ...current,
        files: patchFile(current.files, fileId, patch),
      })),
  };

  const saved = { queryClient, router, userId, checkId };

  const save = async (): Promise<void> => {
    if (!draft.record || busy) {
      return;
    }
    if (draft.originalWords.trim() && !savedObservation) {
      setStep(4);
      setError(t('confirmOriginalWords'));

      return;
    }

    setBusy(true);
    setAttempted(true);
    setError('');
    try {
      // evidence for an action of another record, or one no longer in its run, is never created (PT-13)
      try {
        await actionLink.verify();
      } catch (cause) {
        setError(describeActionLinkError(cause, t));

        return;
      }
      // only labels the collector picked or typed become components; the whole record and a
      // deselected file name none
      const components = [
        ...draft.record.components,
        ...componentLabelsOf(draft.files)
          .filter(
            (label) =>
              !draft.record?.components.some(
                (component) => component.label === label,
              ),
          )
          .map((label) => ({ id: randomUUID(), label })),
      ];
      let record = draft.record;
      if (!savedFields) {
        const matched = editedFields.locationLabel
          ? locations?.find(
              (location) => location.label === draft.locationLabel.trim(),
            )
          : undefined;
        const location =
          editedFields.locationLabel && draft.locationLabel.trim() && !matched
            ? await api.post('/v1/locations', locationSchema, {
                body: { label: draft.locationLabel.trim() },
              })
            : matched;
        const fields = {
          name: editedFields.name
            ? draft.name.trim() || null
            : draft.record.name,
          unitKind: draft.kind,
          // the piece count is the collector's to give; labelled photos never derive it (FR-2)
          components,
          location: {
            locationId: location?.id ?? draft.record.location.locationId,
            detail: editedFields.locationDetail
              ? draft.locationDetail
              : draft.record.location.detail,
          },
          description: draft.adoptedDescription
            ? draft.preparedDescription
            : draft.record.description,
          tags: editedFields.category
            ? draft.category.trim()
              ? [draft.category.trim()]
              : []
            : draft.record.tags,
          dimensions:
            editedFields.height && draft.height
              ? {
                  ...draft.record.dimensions,
                  height: {
                    value: Number(draft.height),
                    unit: draft.heightUnit,
                  },
                }
              : draft.record.dimensions,
        };
        const patch = recordPatchSchema.parse({
          expectedRevision: draft.record.recordRevision,
          fields,
        });
        record = await api.patch(
          `/v1/records/${draft.record.id}`,
          recordDetailSchema,
          { body: patch, idempotencyKey: randomUUID() },
        );
      }
      update({ record });
      setSavedFields(true);
      // a copy still being made when saving starts is waited for, so the file uploads with its
      // journal and never completes again from a stale one
      const nextFiles = await withKeptCopies(draft.files);
      const failures: Record<string, string> = {};
      for (const [index, file] of nextFiles.entries()) {
        if (file.excluded) {
          continue;
        }
        const component = components.find(
          (item) => item.label === file.componentLabel.trim(),
        );
        if (file.state !== 'uploaded') {
          await uploadDraftFile(uploads, {
            files: nextFiles,
            index,
            record,
            components,
            failures,
          });
          if (nextFiles[index]?.state === 'failed') {
            continue;
          }
        }
        // a photo answering a check or an analysis action becomes an evidence anchor linked to it
        if (
          (checkId || actionLink.linked) &&
          file.kind === 'photo' &&
          !nextFiles[index]?.checkLinked
        ) {
          try {
            const assetId = nextFiles[index]?.assetId;
            if (!assetId) {
              throw new Error(t('uploadFailed'));
            }
            const detail = await api.get(
              `/v1/media/${assetId}`,
              mediaDetailSchema,
            );
            const view = detail.asset.views[0];
            const anchor = await api.post(
              '/v1/evidence',
              evidenceAnchorSchema,
              {
                body: {
                  requestKey: file.checkRequestKey ?? file.id,
                  mode: 'create',
                  checkId,
                  evidence: {
                    kind: 'image',
                    recordId: record.id,
                    componentIds: component ? [component.id] : [],
                    originalAssetId: assetId,
                    canonicalViewId: view.id,
                    scope: { kind: 'whole' },
                  },
                },
                idempotencyKey: file.checkRequestKey ?? file.id,
              },
            );
            const linked = { checkLinked: true, anchorId: anchor.id };
            nextFiles[index] = { ...nextFiles[index], ...linked };
            uploads.publish(file.id, linked);
          } catch (cause) {
            failures[file.id] = (cause as Error).message;
          }
        }
      }
      setFileErrors(failures);
      if (Object.keys(failures).length > 0) {
        setError(t('uploadFailed'));
        setStep(6);

        return;
      }
      if (
        !nextFiles.some(
          (file) => file.state === 'uploaded' && file.purpose === 'object',
        )
      ) {
        setError(t('photoRequired'));
        setStep(6);

        return;
      }
      const anchorIds = nextFiles.flatMap((file) =>
        file.anchorId ? [file.anchorId] : [],
      );
      // a failure leaves the files linked, so saving again only retries the action
      if (anchorIds.length > 0) {
        try {
          await actionLink.supply({ evidenceAnchorIds: anchorIds });
        } catch (cause) {
          setError(describeActionLinkError(cause, t));

          return;
        }
      }
      await openSavedRecord(saved, record, nextFiles);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * uploads only the given files, sending only what storage lacks; the record's fields and its
   * photo requirement are left to Save
   * @param fileIds files to upload
   * @param open whether to open the record once every file uploaded
   */
  const send = async (
    fileIds: readonly string[],
    open: boolean,
  ): Promise<void> => {
    const record = draft.record;
    if (!record || busy) {
      return;
    }
    setBusy(true);
    setError('');
    const nextFiles = await withKeptCopies(draft.files);
    const failures: Record<string, string> = {};
    for (const [index, file] of nextFiles.entries()) {
      if (fileIds.includes(file.id) && file.state !== 'uploaded') {
        await uploadDraftFile(uploads, {
          files: nextFiles,
          index,
          record,
          components: record.components,
          failures,
        });
      }
    }
    setFileErrors((current) => ({
      ...Object.fromEntries(
        Object.entries(current).filter(([id]) => !fileIds.includes(id)),
      ),
      ...failures,
    }));
    if (Object.keys(failures).length > 0) {
      setError(t('uploadFailed'));
    } else if (open) {
      await openSavedRecord(saved, record, nextFiles);
    }
    setBusy(false);
  };

  return {
    fileErrors,
    attempted,
    save,
    retry: async (fileIds) => send(fileIds, false),
    resume: async (fileIds) => send(fileIds, true),
  };
}
