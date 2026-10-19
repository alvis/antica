import { describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';

import { uploadMedia } from '../../../adapters/media-upload';
import { collectionRecord } from '../../../mobile.spec.fixtures';

import { useCaptureJobs } from './useCaptureJobs';
import { useCaptureObservation } from './useCaptureObservation';
import { useCaptureRecord } from './useCaptureRecord';
import { useEditDraft } from './useEditDraft';

import type { UseQueryResult } from '@tanstack/react-query';

import type { ReactNode } from 'react';

import type { EditDraftDetail, TranscriptionDetail } from '@antica/contracts';

import type { LocalMedia } from '../../../adapters/media-upload';

import type { CaptureDraft, CaptureRuntime } from './useCaptureDraft';

jest.mock('../../../adapters/media-upload', () => ({ uploadMedia: jest.fn() }));
jest.mock('expo-file-system', () =>
  jest.requireActual('../../../adapters/file-system.spec.fixtures'),
);
jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));

const voice: LocalMedia = {
  id: 'voice',
  uri: 'file:///cache/voice.m4a',
  name: 'voice.m4a',
  mimeType: 'audio/mp4',
  kind: 'audio',
  purpose: 'voice_note',
  componentLabel: '',
  state: 'local',
  assetId: null,
};

const draft = {
  record: { ...collectionRecord },
  files: [voice],
  originalWords: 'a bronze mirror',
  transcriptionId: 'transcription',
} as unknown as CaptureDraft;

/**
 * builds a runtime whose transport records every request while another action is running
 * @returns the busy runtime and its transport
 */
function busyRuntime(): {
  runtime: CaptureRuntime;
  get: jest.Mock;
  post: jest.Mock;
  setBusy: jest.Mock;
} {
  const get = jest.fn();
  const post = jest.fn();
  const setBusy = jest.fn();

  return {
    runtime: {
      api: { get, post, patch: jest.fn() },
      t: (key: string) => key,
      busy: true,
      setBusy,
      setError: jest.fn(),
    } as never,
    get,
    post,
    setBusy,
  };
}

/**
 * provides a fresh query cache to hooks that follow jobs
 * @param props wrapper props
 * @param props.children the hook host
 * @returns the provider
 */
function Queries({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

const idle = { data: undefined } as UseQueryResult<TranscriptionDetail>;

describe('busy capture actions', () => {
  it('should not upload or transcribe a voice note while another action runs', async () => {
    const { runtime, get, setBusy } = busyRuntime();
    const view = await renderHook(
      () =>
        useCaptureJobs(runtime, {
          draft,
          setDraft: jest.fn(),
          update: jest.fn(),
        }),
      { wrapper: Queries },
    );

    await act(async () => view.result.current.prepareVoice());

    expect(uploadMedia).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(setBusy).not.toHaveBeenCalled();
  });

  it('should not confirm the original words while another action runs', async () => {
    const { runtime, get, post, setBusy } = busyRuntime();
    const view = await renderHook(() =>
      useCaptureObservation(runtime, {
        draft,
        update: jest.fn(),
        jobs: {
          transcriptionResourceId: null,
          transcriptionDetail: idle,
        },
        checkId: undefined,
        queryClient: new QueryClient(),
      }),
    );

    await act(async () => view.result.current.confirmWords());

    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(setBusy).not.toHaveBeenCalled();
  });

  it('should not create a second draft record while another action runs', async () => {
    const { runtime, post, setBusy } = busyRuntime();
    const view = await renderHook(() =>
      useCaptureRecord(runtime, {
        setDraft: jest.fn(),
        setStep: jest.fn(),
        update: jest.fn(),
        recordId: undefined,
        resumeStep: 1,
      }),
    );

    await act(async () => view.result.current('single'));

    expect(post).not.toHaveBeenCalled();
    expect(setBusy).not.toHaveBeenCalled();
  });
});

describe('busy description actions', () => {
  it('should not prepare a description while another action runs', async () => {
    const { runtime, get, post, setBusy } = busyRuntime();
    const view = await renderEditDraft(runtime);

    await act(async () => view.result.current.prepareDescription());

    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(setBusy).not.toHaveBeenCalled();
  });

  it('should not apply selected proposals while another action runs', async () => {
    const { runtime, post, setBusy } = busyRuntime();
    const view = await renderEditDraft(runtime);

    await act(async () => view.result.current.toggleProposal('proposal'));
    await act(async () => view.result.current.applyEdit());

    expect(post).not.toHaveBeenCalled();
    expect(setBusy).not.toHaveBeenCalled();
  });
});

/**
 * runs the edit-draft hook with a confirmed observation and no proposals loaded yet
 * @param runtime shared capture runtime
 * @returns the rendered hook
 */
async function renderEditDraft(
  runtime: CaptureRuntime,
): Promise<{ result: { current: ReturnType<typeof useEditDraft> } }> {
  return renderHook(() =>
    useEditDraft(runtime, {
      draft,
      setDraft: jest.fn(),
      setEditedFields: jest.fn(),
      update: jest.fn(),
      jobs: {
        editDetail: {
          data: { result: undefined },
        } as unknown as UseQueryResult<EditDraftDetail>,
        setEditJobId: jest.fn(),
        setEditResourceId: jest.fn(),
      },
      confirmedObservationId: 'observation',
    }),
  );
}
