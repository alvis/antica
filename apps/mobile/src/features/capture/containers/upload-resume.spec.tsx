import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import {
  fakeDisk,
  resetFakeDisk,
} from '../../../adapters/file-system.spec.fixtures';
import {
  claimRecord,
  keepFile,
  listJournals,
} from '../../../adapters/upload-journal';
import {
  collectorId,
  renderMobile,
  savedLanguage,
} from '../../../mobile.spec.fixtures';

import { RecordUploadsContainer } from './RecordUploadsContainer';
import { UploadResumeContainer } from './UploadResumeContainer';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-file-system', () =>
  jest.requireActual('../../../adapters/file-system.spec.fixtures'),
);
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

const recordId = '00000000-0000-4000-8000-000000000001';
const uploads = `file:///documents/uploads/${collectorId}/${recordId}`;

/**
 * keeps unfinished photos of the record, as a session the app closed on left them
 * @param count photos to keep
 */
async function leaveUnfinished(count: number): Promise<void> {
  for (let index = 1; index <= count; index += 1) {
    const id = `00000000-0000-4000-8000-00000000020${index}`;
    fakeDisk().files.set(`file:///cache/${id}.jpg`, 'bytes');
    await keepFile(
      {
        id,
        uri: `file:///cache/${id}.jpg`,
        name: `${id}.jpg`,
        mimeType: 'image/jpeg',
        kind: 'photo',
        purpose: 'object',
        componentLabel: '',
        state: 'local',
        assetId: null,
      },
      { userId: collectorId, recordId, label: 'Celadon bowl' },
    );
  }
}

beforeEach(() => resetFakeDisk());

describe('UploadResumeContainer', () => {
  it('should offer to resume after a restart without uploading anything itself', async () => {
    await leaveUnfinished(2);
    const view = await renderMobile(<UploadResumeContainer />, {});

    expect(screen.getByTestId('upload-resume-banner')).toHaveTextContent(
      /^2 files from Celadon bowl have not finished uploading/,
    );
    expect(
      screen.getByText(
        'Nothing uploads until you resume, to save mobile data and battery.',
      ),
    ).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Resume upload' }),
    );

    expect(view.router.push).toHaveBeenCalledWith(
      `/capture?recordId=${recordId}&resume=1`,
    );
    expect(view.commands).not.toHaveBeenCalled();
    expect(view.reads).not.toHaveBeenCalled();
  });

  it('should delete the local copies only after the collector confirms discarding', async () => {
    await leaveUnfinished(1);
    await renderMobile(<UploadResumeContainer />, {});

    await fireEvent.press(screen.getByTestId('upload-discard'));
    expect(
      screen.getByText('Discard 1 file? Its copy on this device is deleted.'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Keep' }));
    expect(listJournals(collectorId).entries).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Discard' }));
    await fireEvent.press(
      screen.getByRole('button', { name: 'Discard files' }),
    );

    expect(listJournals(collectorId).entries).toEqual([]);
    expect(screen.queryByTestId('upload-resume-banner')).toBeNull();
  });

  it('should hide the prompt while the record is open and speak the collector language', async () => {
    await leaveUnfinished(1);
    await renderMobile(<UploadResumeContainer />, {}, savedLanguage('zh-Hant'));

    expect(screen.getByTestId('upload-resume-banner')).toHaveTextContent(
      /^「Celadon bowl」有 1 個檔案尚未完成上傳/,
    );
    const release = await act(async () => claimRecord(recordId));
    expect(screen.queryByTestId('upload-resume-banner')).toBeNull();
    await act(async () => release());
    expect(screen.getByTestId('upload-resume')).toHaveTextContent('繼續上傳');
  });

  it('should show nothing when every upload finished', async () => {
    await renderMobile(<UploadResumeContainer />, {});

    expect(screen.queryByTestId('upload-resume-banner')).toBeNull();
  });
});

describe('UploadResumeContainer journals', () => {
  it("should never show another collector's unfinished uploads, nor any when signed out", async () => {
    await leaveUnfinished(1);
    await renderMobile(
      <UploadResumeContainer />,
      {},
      { userId: 'collector-2' },
    );

    expect(screen.queryByTestId('upload-resume-banner')).toBeNull();
    await screen.unmount();
    await renderMobile(<UploadResumeContainer />, {}, { userId: null });
    expect(screen.queryByTestId('upload-resume-banner')).toBeNull();
    // signing out or switching collector never deletes the first collector's files
    expect(listJournals(collectorId).entries).toHaveLength(1);
  });

  it('should delete unusable journals at startup and never offer them for upload', async () => {
    await leaveUnfinished(2);
    const torn = `${uploads}/00000000-0000-4000-8000-000000000202`;
    fakeDisk().files.set(`${torn}/journal.json`, '{"version":');

    await renderMobile(<UploadResumeContainer />, {});

    expect(screen.getByTestId('upload-resume-banner')).toHaveTextContent(
      /^1 file from Celadon bowl/,
    );
    expect(fakeDisk().files.has(`${torn}/original.jpg`)).toBe(false);
    expect(listJournals(collectorId).unreadable).toEqual([]);
  });

  it('should discard unusable journals of a record with its unfinished files', async () => {
    await leaveUnfinished(1);
    fakeDisk().directories.add(`${uploads}/lone`);
    fakeDisk().files.set(`${uploads}/lone/journal.json.tmp`, '{');
    await renderMobile(<UploadResumeContainer />, {});
    // a directory made after startup, as a crash leaves it, is gone with its record
    fakeDisk().directories.add(`${uploads}/late`);

    await fireEvent.press(screen.getByTestId('upload-discard'));
    await fireEvent.press(
      screen.getByRole('button', { name: 'Discard files' }),
    );

    expect(listJournals(collectorId)).toEqual({ entries: [], unreadable: [] });
    expect(
      [...fakeDisk().files.keys()].filter((uri) => uri.includes('/documents/')),
    ).toEqual([]);
  });
});

describe('RecordUploadsContainer', () => {
  it('should count the files not uploaded and retry them from the record', async () => {
    await leaveUnfinished(2);
    const view = await renderMobile(
      <RecordUploadsContainer recordId={recordId} />,
      {},
    );

    expect(screen.getByTestId('record-files-not-uploaded')).toHaveTextContent(
      '2 files not uploaded',
    );
    await fireEvent.press(screen.getByTestId('record-files-retry'));

    expect(view.router.push).toHaveBeenCalledWith(
      `/capture?recordId=${recordId}&resume=1`,
    );
  });

  it('should show nothing for a record whose files all uploaded', async () => {
    await leaveUnfinished(1);
    await renderMobile(
      <RecordUploadsContainer recordId="00000000-0000-4000-8000-000000000009" />,
      {},
    );

    await waitFor(() =>
      expect(screen.queryByTestId('record-files-not-uploaded')).toBeNull(),
    );
  });
});
