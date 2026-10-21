import { useRouter } from 'expo-router';

import { useLocale } from '../../../providers/LocaleProvider';
import { recordTitle } from '../../../utils/record-title';

import { RecordSegmentHeader } from '../components/RecordSegmentHeader';
import { useRecordCoverPhoto } from '../hooks/useRecordCoverPhoto';
import { useRecordHub } from '../hooks/useRecordHub';

import type { FC } from 'react';

import type { AskContext } from '../../assistant/ask-context';

import type {
  RecordSegment,
  RecordSegmentHeaderProps,
} from '../components/RecordSegmentHeader';

/** properties for the compact header of one of the record's segments */
export type RecordSegmentHeaderContainerProps = {
  recordId: string;
  current: RecordSegmentHeaderProps['current'];
  /** the status line under the name; the segment decides what it says */
  subtitle?: string;
  /** what the assistant pill attaches; the record by default */
  askContext?: AskContext;
};

/**
 * the route of each segment; 資料 and 查驗 are sections of the record hub
 * @param recordId record the segments belong to
 * @param runId the latest analysis, which 建議 shows
 * @returns the href of each segment, or nothing for 建議 without a run
 */
export function recordSegmentRoutes(
  recordId: string,
  runId: string | null | undefined,
): Record<RecordSegment, string | undefined> {
  const recordPath = `/collection/${encodeURIComponent(recordId)}`;

  return {
    data: recordPath,
    checks: `${recordPath}?segment=checks`,
    suggestions: runId ? `/analysis/${encodeURIComponent(runId)}` : undefined,
    chat: `${recordPath}/messages`,
    history: `${recordPath}/history`,
  };
}

/**
 * reads the record, its cover and waiting suggestions for the compact header, and swaps segments in
 * place: 建議, 對話 and 紀錄 replace each other, while 資料 and 查驗 return to the record hub
 * @param props header properties
 * @param props.recordId record on screen
 * @param props.current the segment on screen
 * @param props.subtitle the status line under the name
 * @param props.askContext what the assistant pill attaches
 * @returns the header
 */
export const RecordSegmentHeaderContainer: FC<
  RecordSegmentHeaderContainerProps
> = ({ recordId, current, subtitle, askContext }) => {
  const router = useRouter();
  const { t } = useLocale();
  const hub = useRecordHub(recordId);
  const coverUri = useRecordCoverPhoto(recordId);
  const record = hub.record.data;
  const routes = recordSegmentRoutes(recordId, record?.latestRunId);

  const open = (segment: RecordSegment): void => {
    const href = routes[segment];
    if (!href) {
      return;
    }
    if (segment === 'data' || segment === 'checks') {
      // the hub is usually right below; going back to it keeps the stack one segment deep
      router.dismissTo(href);
    } else {
      router.replace(href);
    }
  };

  return (
    <RecordSegmentHeader
      name={recordTitle(record?.name ?? null, t('unnamed'))}
      subtitle={subtitle}
      coverUri={coverUri}
      current={current}
      suggestionCount={hub.suggestions.length}
      canOpenSuggestions={Boolean(routes.suggestions)}
      askContext={
        askContext ?? {
          kind: 'record',
          recordId,
          name: record?.name ?? undefined,
          code: record?.code,
        }
      }
      onBack={() => router.back()}
      onSegment={open}
    />
  );
};
