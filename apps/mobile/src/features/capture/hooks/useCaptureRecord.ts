import { randomUUID } from 'expo-crypto';
import { useEffect } from 'react';

import { recordDetailSchema } from '@antica/contracts';

import type { CaptureDraftState, CaptureRuntime } from './useCaptureDraft';

/** creates the draft record for a single item or a set */
export type CreateDraft = (kind: 'single' | 'set') => Promise<void>;

/** draft updaters and the record a capture resumes */
type ResumeContext = Pick<
  CaptureDraftState,
  'setDraft' | 'setStep' | 'update'
> & {
  recordId: string | undefined;
  resumeStep: number;
};

/**
 * resumes an existing record at the given step, or creates a new draft record
 * @param runtime API transport and shared busy/error status
 * @param runtime.api authenticated API transport
 * @param runtime.busy whether another capture action is running
 * @param runtime.setBusy busy-state updater
 * @param runtime.setError error reporter shown below the steps
 * @param context draft updaters and the record to resume
 * @param context.setDraft capture draft updater
 * @param context.setStep capture step updater
 * @param context.update capture draft patcher
 * @param context.recordId record to resume, when capture was opened for one
 * @param context.resumeStep step a resumed record opens at
 * @returns the action that creates a new draft record
 */
export function useCaptureRecord(
  { api, busy, setBusy, setError }: Omit<CaptureRuntime, 't'>,
  { setDraft, setStep, update, recordId, resumeStep }: ResumeContext,
): CreateDraft {
  useEffect(() => {
    if (!recordId) {
      return;
    }
    let active = true;
    void api
      .get(`/v1/records/${recordId}`, recordDetailSchema)
      .then((record) => {
        if (active) {
          setDraft((current) => ({
            ...current,
            record,
            kind: record.unitKind,
            name: record.name ?? '',
            preparedDescription: record.description,
            locationDetail: record.location.detail,
          }));
          setStep(resumeStep);
        }
      })
      .catch((cause) => {
        if (active) {
          setError((cause as Error).message);
        }
      });

    return () => {
      active = false;
    };
  }, [api, recordId, resumeStep]);

  return async (kind) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const record = await api.post('/v1/records', recordDetailSchema, {
        body: { unitKind: kind },
        idempotencyKey: randomUUID(),
      });
      update({ record, kind });
      setStep(2);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };
}
