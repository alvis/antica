import { randomUUID } from 'expo-crypto';
import { useState } from 'react';

import {
  evidenceAnchorSchema,
  locationSchema,
  mediaDetailSchema,
  recordDetailSchema,
  recordPatchSchema,
} from '@antica/contracts';

import { uploadMedia } from '../../../adapters/media-upload';

import { componentLabelsOf } from '../capture-grid';

import { describeActionLinkError } from './useActionLink';

import type { QueryClient } from '@tanstack/react-query';

import type { useRouter } from 'expo-router';

import type { Location } from '@antica/contracts';

import type { ActionLink } from './useActionLink';
import type { CaptureDraftState, CaptureRuntime } from './useCaptureDraft';

/** per-file upload errors and the save action */
export interface CaptureSave {
  fileErrors: Record<string, string>;
  save: () => Promise<void>;
}

/**
 * saves the record fields, uploads pending media, links check evidence, and opens the record
 * @param runtime API transport, translations, and shared busy/error status
 * @param context draft state, route context, and saved locations
 * @param context.draft record, media, and words collected so far
 * @param context.editedFields fields the collector edited
 * @param context.setStep capture step updater
 * @param context.update capture draft patcher
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
    update,
    savedObservation,
    locations,
    checkId,
    actionLink,
    queryClient,
    router,
  }: Pick<
    CaptureDraftState,
    'draft' | 'editedFields' | 'setStep' | 'update'
  > & {
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
      const nextFiles = [...draft.files];
      const failures: Record<string, string> = {};
      for (const [index, file] of nextFiles.entries()) {
        if (file.excluded) {
          continue;
        }
        const component = components.find(
          (item) => item.label === file.componentLabel.trim(),
        );
        if (file.state !== 'uploaded') {
          nextFiles[index] = { ...file, state: 'uploading' };
          update({ files: [...nextFiles] });
          try {
            const assetId = await uploadMedia(
              api,
              file,
              { kind: 'record', id: record.id },
              component ? [component.id] : [],
            );
            nextFiles[index] = { ...file, state: 'uploaded', assetId };
          } catch (cause) {
            nextFiles[index] = { ...file, state: 'failed' };
            failures[file.id] = (cause as Error).message;
            update({ files: [...nextFiles] });
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
            nextFiles[index] = {
              ...nextFiles[index],
              checkLinked: true,
              anchorId: anchor.id,
            };
          } catch (cause) {
            failures[file.id] = (cause as Error).message;
          }
        }
        update({ files: [...nextFiles] });
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['records'] }),
        queryClient.invalidateQueries({ queryKey: ['record', record.id] }),
        queryClient.invalidateQueries({
          queryKey: ['observations', record.id],
        }),
      ]);
      const query = checkId ? `?checkId=${checkId}` : '';
      router.replace(`/collection/${record.id}${query}`);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return { fileErrors, save };
}
