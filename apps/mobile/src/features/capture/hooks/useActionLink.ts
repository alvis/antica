import { useQuery } from '@tanstack/react-query';

import { randomUUID } from 'expo-crypto';

import { useRef } from 'react';

import {
  actionResolutionRequestSchema,
  actionResolutionResultSchema,
  recordDetailSchema,
} from '@antica/contracts';

import { analysisRunQuery } from '../../analysis/api/analysis-run-query';
import { describeMessageError } from '../../collection/messages/api/message-errors';

import type { QueryClient } from '@tanstack/react-query';

import type { ApiTransport } from '@antica/client';
import type {
  ActionSupport,
  AnalysisRunDetail,
  NextAction,
} from '@antica/contracts';

import type { MessageKey } from '../../../i18n/messages';

/** why an action cannot receive the evidence of this capture */
export type ActionLinkProblem = Extract<
  MessageKey,
  'actionRecordMismatch' | 'actionMissing'
>;

/** a refusal to link evidence to an action, raised before anything is created or changed */
export class ActionLinkError extends Error {
  public readonly problem: ActionLinkProblem;

  /**
   * names the reason the action cannot be answered
   * @param problem translation key of the reason
   */
  constructor(problem: ActionLinkProblem) {
    super(problem);
    this.name = 'ActionLinkError';
    this.problem = problem;
  }
}

/**
 * explains a failed action link or supply in the collector's language, never in server text
 * @param cause value thrown while verifying or supplying the action
 * @param t translation function for message keys
 * @returns a translated explanation
 */
export function describeActionLinkError(
  cause: unknown,
  t: (key: MessageKey) => string,
): string {
  return cause instanceof ActionLinkError
    ? t(cause.problem)
    : describeMessageError(cause, t, { REVISION_CONFLICT: 'actionChanged' });
}

/** the analysis action a capture answers, when it was opened from one (C04) */
export interface ActionLink {
  /** the action being answered; undefined until its run loads or when capture was not opened from one */
  action: NextAction | undefined;
  /** check the loaded action names, which new evidence is linked to */
  checkId: string | undefined;
  /** whether capture was opened from an action */
  linked: boolean;
  /** why the loaded action cannot be answered here, when it cannot */
  problem: ActionLinkProblem | null;
  /** reads the run again and refuses an action of another record or one no longer in the run */
  verify: () => Promise<void>;
  /**
   * marks the action supplied with the new evidence, unless it is no longer pending
   * @param support new evidence anchors or observations of the run's record
   */
  supply: (
    support: Pick<ActionSupport, 'evidenceAnchorIds' | 'observationIds'>,
  ) => Promise<void>;
}

/**
 * finds the problem that stops a run's action from receiving this record's evidence
 * @param run run that suggested the action
 * @param recordId record the capture adds evidence to
 * @param actionId action being answered
 * @returns the problem, or null when the action can be answered
 */
function linkProblem(
  run: AnalysisRunDetail,
  recordId: string | undefined,
  actionId: string | undefined,
): ActionLinkProblem | null {
  if (run.recordId !== recordId) {
    return 'actionRecordMismatch';
  }

  return run.result.output?.nextActions.some((item) => item.id === actionId)
    ? null
    : 'actionMissing';
}

/** what verifying and supplying one linked action needs */
interface LinkContext {
  api: ApiTransport;
  queryClient: QueryClient;
  recordId: string | undefined;
  runId: string;
  actionId: string;
  /** one key per supply body, so retrying after a lost reply cannot apply it twice */
  attempt: { current: { body: string; key: string } | null };
}

/**
 * reads the run again and refuses an action of another record or one no longer in the run
 * @param context the linked action and its record
 * @param context.api authenticated API transport
 * @param context.queryClient query cache holding the run
 * @param context.recordId record the capture adds evidence to
 * @param context.runId run that suggested the action
 * @param context.actionId action being answered
 * @returns the fresh run
 */
async function latestLinkedRun({
  api,
  queryClient,
  recordId,
  runId,
  actionId,
}: LinkContext): Promise<AnalysisRunDetail> {
  const latest = await queryClient.fetchQuery({
    ...analysisRunQuery(api, runId),
    staleTime: 0,
  });
  const refusal = linkProblem(latest, recordId, actionId);
  if (refusal) {
    throw new ActionLinkError(refusal);
  }

  return latest;
}

/**
 * marks a pending action supplied with new evidence of its record, linked to the check it names
 * @param context the linked action and its record
 * @param support new evidence anchors or observations
 */
async function supplyAction(
  context: LinkContext,
  support: Pick<ActionSupport, 'evidenceAnchorIds' | 'observationIds'>,
): Promise<void> {
  const { api, queryClient, runId, actionId, attempt } = context;
  const latest = await latestLinkedRun(context);
  const state = latest.result.actionStates.find(
    (item) => item.actionId === actionId,
  );
  // a supplied or dismissed action keeps its saved state; capture never reopens it
  if (state?.status !== 'pending') {
    return;
  }
  const checkId = latest.result.output?.nextActions.find(
    (item) => item.id === actionId,
  )?.checkId;
  const record = await api.get(
    `/v1/records/${latest.recordId}`,
    recordDetailSchema,
  );
  const request = actionResolutionRequestSchema.parse({
    status: 'supplied',
    expectedActionRevision: state.revision,
    expectedRecordRevision: record.recordRevision,
    support: { ...support, ...(checkId ? { checkIds: [checkId] } : {}) },
  });
  const body = JSON.stringify(request);
  if (attempt.current?.body !== body) {
    attempt.current = { body, key: randomUUID() };
  }
  await api.patch(
    `/v1/analyses/${runId}/actions/${actionId}`,
    actionResolutionResultSchema,
    { body: request, idempotencyKey: attempt.current.key },
  );
  attempt.current = null;
  await queryClient.invalidateQueries({ queryKey: ['analysis', runId] });
}

/**
 * links new capture evidence to the analysis action and the check it names (C04, PT-13)
 * @param api authenticated API transport
 * @param context route context and cache
 * @param context.recordId record the capture adds evidence to
 * @param context.runId run that suggested the action
 * @param context.actionId action being answered
 * @param context.queryClient query cache refreshed after the action is supplied
 * @returns the answered action, its check, and the verify and supply steps
 */
export function useActionLink(
  api: ApiTransport,
  {
    recordId,
    runId,
    actionId,
    queryClient,
  }: {
    recordId: string | undefined;
    runId: string | undefined;
    actionId: string | undefined;
    queryClient: QueryClient;
  },
): ActionLink {
  const attempt = useRef<LinkContext['attempt']['current']>(null);
  const run = useQuery({
    ...analysisRunQuery(api, runId ?? ''),
    enabled: Boolean(runId && actionId),
  });
  const context =
    runId && actionId
      ? { api, queryClient, recordId, runId, actionId, attempt }
      : null;
  const problem = run.data ? linkProblem(run.data, recordId, actionId) : null;
  const action = problem
    ? undefined
    : run.data?.result.output?.nextActions.find((item) => item.id === actionId);

  return {
    action,
    checkId: action?.checkId,
    linked: Boolean(context),
    problem,
    verify: async () => {
      if (context) {
        await latestLinkedRun(context);
      }
    },
    supply: async (support) => {
      if (context) {
        await supplyAction(context, support);
      }
    },
  };
}
