import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { serve } from '@hono/node-server';

import {
  createInngestWorkflow,
  readKnowledgeConfiguration,
  readWorkflowConfiguration,
} from '@antica/platform';
import {
  createConfiguredModels,
  readModelConfiguration,
} from '@antica/platform/ai';

import { serve as serveInngest } from 'inngest/hono';

import {
  composeApplication,
  readApplicationConfig,
  readImageConfiguration,
} from './composition.js';

import type { ApplicationRuntime } from './composition.js';
import type { ApplicationSettings } from './configuration.js';

/**
 * loads the selected application settings without starting a listener
 * @returns validated application and provider settings
 */
function loadSettings(): ApplicationSettings {
  const environmentFile = fileURLToPath(
    new URL('../../../.env', import.meta.url),
  );
  if (existsSync(environmentFile)) {
    process.loadEnvFile(environmentFile);
  }
  const config = readApplicationConfig(process.env);
  if (!config.success) {
    throw new Error(config.error.message);
  }
  const modelConfig = readModelConfiguration(process.env);
  if (!modelConfig.success) {
    throw new Error(modelConfig.error.message);
  }
  const configured = createConfiguredModels(modelConfig.data);
  if (!configured.success) {
    throw new Error(configured.error.message);
  }
  const imageConfig = readImageConfiguration(process.env);
  if (!imageConfig.success) {
    throw new Error(imageConfig.error.message);
  }
  const knowledgeConfig = readKnowledgeConfiguration(process.env);
  if (!knowledgeConfig.success) {
    throw new Error(knowledgeConfig.error.message);
  }

  return {
    app: config.data,
    models: configured.data,
    image: imageConfig.data,
    knowledge: knowledgeConfig.data,
    modelConfig: modelConfig.data,
  };
}

/** starts the API from explicit validated environment settings */
async function main(): Promise<void> {
  const settings = loadSettings();
  const workflowConfig = readWorkflowConfiguration(process.env);
  if (!workflowConfig.success) {
    throw new Error(workflowConfig.error.message);
  }
  const runtime = await composeApplication(settings);
  if (process.argv.includes('--drain')) {
    await drainOnce(runtime);

    return;
  }
  if (workflowConfig.data.driver === 'inngest') {
    runtime.app.on(
      ['GET', 'POST', 'PUT'],
      '/api/inngest',
      serveInngest({
        ...createInngestWorkflow(workflowConfig.data, runtime.drain),
        servePath: '/api/inngest',
      }),
    );
  }
  startListener(runtime, settings);
}

/**
 * drains queued work once and releases persistent resources
 * @param runtime composed persistent application
 */
async function drainOnce(runtime: ApplicationRuntime): Promise<void> {
  try {
    const result = await runtime.drain();
    process.stdout.write(
      `${JSON.stringify({ event: 'jobs.drained', ...result })}\n`,
    );
    if (result.failures.length) {
      process.exitCode = 1;
    }
  } finally {
    await runtime.close();
  }
}

/**
 * starts the listener with graceful database shutdown
 * @param runtime composed persistent application
 * @param settings validated binding configuration
 */
function startListener(
  runtime: ApplicationRuntime,
  settings: ApplicationSettings,
): void {
  const server = serve(
    {
      fetch: runtime.app.fetch,
      port: settings.app.PORT,
      hostname: settings.app.HOST,
    },
    (address) => {
      process.stdout.write(
        `${JSON.stringify({ event: 'api.ready', port: address.port })}\n`,
      );
    },
  );
  let stopping = false;
  const stop = (): void => {
    if (stopping) {
      return;
    }
    stopping = true;
    server.close((error) => {
      void runtime
        .close()
        .then(() => {
          if (error) {
            process.exitCode = 1;
          }
        })
        .catch(() => {
          process.exitCode = 1;
        });
    });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  server.once('error', () => {
    process.stderr.write(`${JSON.stringify({ event: 'api.listen_failed' })}\n`);
    process.exitCode = 1;
    stop();
  });
}

void main().catch(() => {
  process.stderr.write(
    `${JSON.stringify({ event: 'api.startup_failed', message: 'Check the required configuration and database migrations.' })}\n`,
  );
  process.exitCode = 1;
});
