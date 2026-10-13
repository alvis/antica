import { Inngest } from 'inngest';

import type { InngestFunction } from 'inngest';

import type { OperationResult } from '@antica/application/ports';

/** selects the explicit local drain or signed Inngest execution boundary */
export type WorkflowConfiguration =
  | { readonly driver: 'local' }
  | {
      readonly driver: 'inngest';
      readonly eventKey: string;
      readonly signingKey: string;
      readonly production: boolean;
    };

/**
 * reads workflow settings before starting the application
 * @param env server environment values
 * @returns a selected runtime or a redacted configuration failure
 */
export function readWorkflowConfiguration(
  env: Readonly<Record<string, string | undefined>>,
): OperationResult<WorkflowConfiguration> {
  if (env.ANTICA_WORKFLOW_DRIVER === 'local' && env.NODE_ENV !== 'production') {
    return { success: true, data: { driver: 'local' } };
  }
  if (
    env.ANTICA_WORKFLOW_DRIVER === 'inngest' &&
    env.INNGEST_EVENT_KEY?.trim() &&
    env.INNGEST_SIGNING_KEY?.trim()
  ) {
    return {
      success: true,
      data: {
        driver: 'inngest',
        eventKey: env.INNGEST_EVENT_KEY,
        signingKey: env.INNGEST_SIGNING_KEY,
        production: env.NODE_ENV === 'production',
      },
    };
  }

  return {
    success: false,
    error: {
      code: 'PROVIDER_UNAVAILABLE',
      message:
        'Select ANTICA_WORKFLOW_DRIVER=local for development, or inngest with INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY. Production requires inngest.',
      retryable: false,
    },
  };
}

/** provides the signed SDK endpoint dependencies */
export interface InngestWorkflow {
  readonly client: Inngest;
  readonly functions: InngestFunction.Any[];
  readonly signingKey: string;
}

/**
 * schedules the same persisted drain used by the local one-shot command
 * @param config signed workflow connection settings
 * @param drain leased and idempotent application outbox drain
 * @returns SDK client and functions to mount with the Hono adapter
 */
export function createInngestWorkflow(
  config: Extract<WorkflowConfiguration, { readonly driver: 'inngest' }>,
  drain: () => Promise<unknown>,
): InngestWorkflow {
  const client = new Inngest({
    id: 'antica',
    eventKey: config.eventKey,
    signingKey: config.signingKey,
    isDev: !config.production,
  });
  const dispatch = client.createFunction(
    {
      id: 'persisted-outbox-drain',
      concurrency: { limit: 1 },
      triggers: [{ cron: '* * * * *' }, { event: 'antica/jobs.drain' }],
    },
    async ({ step }) => step.run('drain-persisted-outbox', drain),
  );

  return { client, functions: [dispatch], signingKey: config.signingKey };
}
