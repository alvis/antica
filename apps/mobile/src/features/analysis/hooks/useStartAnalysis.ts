import { useQueryClient } from '@tanstack/react-query';

import { randomUUID } from 'expo-crypto';

import { useRouter } from 'expo-router';

import { useRef, useState } from 'react';

import {
  analysisAcceptedSchema,
  requestAnalysisSchema,
} from '@antica/contracts';

import { recordQuery } from '../../collection/api/record-query';
import {
  describeMessageError,
  isRevisionConflict,
} from '../../collection/messages/api/message-errors';

import type { QueryClient } from '@tanstack/react-query';

import type { ApiTransport } from '@antica/client';
import type { AnalysisAccepted, RecordDetail } from '@antica/contracts';

import type { MessageKey } from '../../../i18n/messages';

/** a record's analysis start action and its progress */
export interface StartAnalysis {
  /** starts one analysis of the record as shown on screen and opens its run */
  start: (record: RecordDetail) => Promise<void>;
  /** whether a start request is running */
  starting: boolean;
  /** localized failure of the last start request */
  error: string;
}

/** record fields that only count edits, never what an analysis reads */
const bookkeepingFields = new Set<keyof RecordDetail>([
  'recordRevision',
  'analysisInputVersion',
  'evidenceVersion',
  'updatedAt',
  'latestRunId',
  'analysisFreshness',
]);

/**
 * projects the part of a record the collector sees and an analysis reads: its fields, media and checks
 * @param record record detail
 * @returns a stable comparison key; media processing changes the version counters but not this
 */
function visibleInput(record: RecordDetail): string {
  return JSON.stringify(
    Object.entries(record).filter(
      ([field]) => !bookkeepingFields.has(field as keyof RecordDetail),
    ),
  );
}

/** what a start request needs from its hook */
interface StartContext {
  api: ApiTransport;
  queryClient: QueryClient;
  /** one key per request body, so retrying after a lost reply cannot start a second run */
  attempt: { current: { revision: number; key: string } | null };
}

/**
 * asks for one run of the record at one revision
 * @param context transport, cache, and the request key of the current attempt
 * @param context.api authenticated API transport
 * @param context.attempt request key of the current attempt
 * @param recordId record to analyse
 * @param revision record revision the request is built from
 * @returns the accepted run
 */
async function requestRun(
  { api, attempt }: StartContext,
  recordId: string,
  revision: number,
): Promise<AnalysisAccepted> {
  if (attempt.current?.revision !== revision) {
    attempt.current = { revision, key: randomUUID() };
  }
  const accepted = await api.post(
    `/v1/records/${recordId}/analyses`,
    analysisAcceptedSchema,
    {
      body: requestAnalysisSchema.parse({ expectedRecordRevision: revision }),
      idempotencyKey: attempt.current.key,
    },
  );
  attempt.current = null;

  return accepted;
}

/**
 * sends the revision on screen; after a conflict it retries once only when the refreshed
 * record still shows the same fields, media and checks, so nothing unseen is analysed
 * @param context transport, cache, and the request key of the current attempt
 * @param shown record as the collector saw it
 * @returns the accepted run, or null when the refreshed record differs
 */
async function requestSeen(
  context: StartContext,
  shown: RecordDetail,
): Promise<AnalysisAccepted | null> {
  try {
    return await requestRun(context, shown.id, shown.recordRevision);
  } catch (cause) {
    if (!isRevisionConflict(cause)) {
      throw cause;
    }
    context.attempt.current = null;
    // refreshes the screen as well, so a changed record shows its new state with Analyse again
    const latest = await context.queryClient.fetchQuery({
      ...recordQuery(context.api, shown.id),
      staleTime: 0,
    });

    return visibleInput(latest) === visibleInput(shown)
      ? requestRun(context, latest.id, latest.recordRevision)
      : null;
  }
}

/**
 * starts one analysis for one record, never twice for repeated presses (C01, B06)
 * @param api authenticated API transport
 * @param t translation function for failures
 * @returns the start action with its progress and failure
 */
export function useStartAnalysis(
  api: ApiTransport,
  t: (key: MessageKey) => string,
): StartAnalysis {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  // closes the gap before a re-render disables the button
  const inFlight = useRef(false);
  const attempt = useRef<StartContext['attempt']['current']>(null);

  const start = async (record: RecordDetail): Promise<void> => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setStarting(true);
    setError('');
    try {
      const accepted = await requestSeen({ api, queryClient, attempt }, record);
      if (!accepted) {
        setError(t('analysisInputChanged'));

        return;
      }
      // the record now names the new run, so its analysis state follows it on return
      await queryClient.invalidateQueries({ queryKey: ['record', record.id] });
      // the analysis runs in the record's 對話 segment, which links to its suggestions once done; the
      // record names the run only once it finishes, so 對話 is told which run to follow
      router.push(
        `/collection/${encodeURIComponent(record.id)}/messages?startedRunId=${encodeURIComponent(accepted.runId)}`,
      );
    } catch (cause) {
      setError(
        describeMessageError(cause, t, {
          REVISION_CONFLICT: 'analysisInputChanged',
        }),
      );
    } finally {
      inFlight.current = false;
      setStarting(false);
    }
  };

  return { start, starting, error };
}
