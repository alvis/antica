import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';

import { collectionRecord, renderMobile } from '../../../mobile.spec.fixtures';

import { CaptureGridStep } from '../components/CaptureGridStep';

import type { ReactElement } from 'react';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

/** a local photo awaiting its upload state */
const photo = {
  uri: 'file:///photo.jpg',
  name: 'photo.jpg',
  mimeType: 'image/jpeg',
  kind: 'photo',
  purpose: 'object',
  componentLabel: '',
  assetId: null,
} as const;
/**
 * renders a grid of three photos: uploading in one request, uploading in parts, and failed
 * @param busy whether another upload is running
 * @param onRetry receives the failed photo's identifier
 * @returns the grid step
 */
const grid = (
  busy: boolean,
  onRetry: (fileId: string) => void,
): ReactElement => (
  <CaptureGridStep
    kind="single"
    recordName="Bowl"
    recordCode={collectionRecord.code}
    files={[
      { ...photo, id: 'sending', state: 'uploading' },
      {
        ...photo,
        id: 'parts',
        state: 'uploading',
        progress: { uploaded: 1, total: 4 },
      },
      { ...photo, id: 'lost', state: 'failed', errorCode: 'NETWORK' },
    ]}
    componentLabels={[]}
    thumbnails={{}}
    busy={busy}
    onToggle={jest.fn()}
    onLabel={jest.fn()}
    onRetry={onRetry}
    onAddPhoto={jest.fn()}
    onAddVideo={jest.fn()}
    onBack={jest.fn()}
    onNext={jest.fn()}
  />
);

describe('CaptureGridStep upload states', () => {
  it('should name each upload state on its tile and retry a failed photo unless busy', async () => {
    const onRetry = jest.fn();
    const view = await renderMobile(grid(true, onRetry), {});

    // a single-request upload shows no part count; a multipart one does
    expect(screen.getByTestId('capture-file-state-1')).toHaveTextContent(
      'Uploading',
    );
    expect(screen.getByTestId('capture-file-state-1')).toBeBusy();
    expect(screen.getByTestId('capture-file-state-2')).toHaveTextContent(
      'Uploading 1/4',
    );
    expect(screen.getByTestId('capture-file-state-3')).toHaveTextContent(
      'Not uploaded',
    );
    expect(
      screen.getByRole('button', { name: 'Retry Photo 3' }),
    ).toBeDisabled();
    view.client.clear();
    await screen.unmount();
    const idle = await renderMobile(grid(false, onRetry), {});
    await fireEvent.press(screen.getByTestId('capture-file-retry-3'));

    expect(onRetry).toHaveBeenCalledWith('lost');
    idle.client.clear();
  });
});
