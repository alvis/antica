import { useState } from 'react';

import type { Dispatch, SetStateAction } from 'react';

import type { ApiTransport } from '@antica/client';
import type { RecordDetail } from '@antica/contracts';

import type { LocalMedia } from '../../../adapters/media-upload';
import type { MessageKey } from '../../../i18n/messages';

/** record, media, words, and fields collected across the capture steps */
export interface CaptureDraft {
  record: RecordDetail | null;
  kind: 'single' | 'set';
  files: LocalMedia[];
  originalWords: string;
  preparedDescription: string;
  adoptedDescription: boolean;
  transcriptionId: string | null;
  name: string;
  category: string;
  height: string;
  heightUnit: 'mm' | 'cm';
  locationLabel: string;
  locationDetail: string;
}

/** draft field whose saved value depends on whether the collector edited it */
export type EditableField =
  'name' | 'category' | 'height' | 'locationLabel' | 'locationDetail';

/** whether the collector edited each editable field */
export type EditedFields = Record<EditableField, boolean>;

/** services and shared status used by every capture action */
export interface CaptureRuntime {
  api: ApiTransport;
  t: (key: MessageKey) => string;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
}

/** capture draft state and its updaters */
export interface CaptureDraftState {
  draft: CaptureDraft;
  setDraft: Dispatch<SetStateAction<CaptureDraft>>;
  editedFields: EditedFields;
  setEditedFields: Dispatch<SetStateAction<EditedFields>>;
  step: number;
  setStep: Dispatch<SetStateAction<number>>;
  update: (patch: Partial<CaptureDraft>) => void;
  editField: (field: EditableField, value: string) => void;
  next: () => void;
}

const initialEditedFields: EditedFields = {
  name: false,
  category: false,
  height: false,
  locationLabel: false,
  locationDetail: false,
};

const initialDraft: CaptureDraft = {
  record: null,
  kind: 'single',
  files: [],
  originalWords: '',
  preparedDescription: '',
  adoptedDescription: false,
  transcriptionId: null,
  name: '',
  category: '',
  height: '',
  heightUnit: 'cm',
  locationLabel: '',
  locationDetail: '',
};

/**
 * holds the capture draft, the fields the collector edited, and the current step
 * @returns draft state with its updaters
 */
export function useCaptureDraft(): CaptureDraftState {
  const [draft, setDraft] = useState<CaptureDraft>(initialDraft);
  const [editedFields, setEditedFields] =
    useState<EditedFields>(initialEditedFields);
  const [step, setStep] = useState(1);

  const update = (patch: Partial<CaptureDraft>): void =>
    setDraft((current) => ({ ...current, ...patch }));

  const editField = (field: EditableField, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }));
    setEditedFields((current) => ({ ...current, [field]: true }));
  };

  const next = (): void => setStep((value) => Math.min(6, value + 1));

  return {
    draft,
    setDraft,
    editedFields,
    setEditedFields,
    step,
    setStep,
    update,
    editField,
    next,
  };
}
