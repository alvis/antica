import { z } from 'zod';

import {
  modelCapabilitiesSchema,
  modelRoleSchema,
  modelSelectionSchema,
} from '@antica/contracts';

import { resolveModel } from './capability.js';
import { createAiSdkModels } from './gateway.js';
import { createDevelopmentModels } from './model.js';

import type { OperationResult } from '@antica/application/ports';
import type { ModelCapabilities, ModelSelection } from '@antica/contracts';

import type { ModelProfile } from './capability.js';
import type { ModelAdapters } from './model.js';

/** carries explicit selections for all four independently configured roles */
export interface ModelSelections {
  readonly analysis: ModelSelection;
  readonly research: ModelSelection;
  readonly recordEditing: ModelSelection;
  readonly transcription: ModelSelection;
}
/** holds server-only configuration; credentials never enter the public catalog */
export interface ModelConfiguration {
  readonly driver: 'development' | 'live';
  readonly production: boolean;
  readonly profiles?: readonly ModelProfile[];
  readonly selections?: ModelSelections;
  readonly gatewayApiKey?: string;
  readonly openAiApiKey?: string;
}
/** bundles model ports and their explicitly selected roles */
export interface ConfiguredModels {
  readonly models: ModelAdapters;
  readonly selections: ModelSelections;
}

const profileSchema = z.strictObject({
  modelId: z.string().min(1),
  provider: z.string().min(1),
  providerModelVersion: z.string().min(1).nullable(),
  adapterKind: z.enum(['live', 'development']),
  roles: z.array(modelRoleSchema).min(1),
  capabilities: modelCapabilitiesSchema,
});
const selectionsSchema = z.strictObject({
  analysis: modelSelectionSchema,
  research: modelSelectionSchema,
  recordEditing: modelSelectionSchema,
  transcription: modelSelectionSchema,
});
const configurationSchema = z.strictObject({
  driver: z.enum(['development', 'live']),
  production: z.boolean(),
  profiles: z.array(profileSchema).optional(),
  selections: selectionsSchema.optional(),
  gatewayApiKey: z.string().min(1).optional(),
  openAiApiKey: z.string().min(1).optional(),
});
const roles = [
  'analysis',
  'research',
  'recordEditing',
  'transcription',
] as const;
const requirements: Record<
  ModelSelection['role'],
  Partial<ModelCapabilities>
> = {
  analysis: { textInput: true, imageInput: true, structuredOutput: true },
  research: { textInput: true, structuredOutput: true },
  recordEditing: { textInput: true, structuredOutput: true },
  transcription: { audioInput: true },
};

/**
 * reads an explicit model configuration without accessing ambient process state
 * @param env server environment values
 * @returns validated configuration or an actionable configuration failure
 */
export function readModelConfiguration(
  env: Readonly<Record<string, string | undefined>>,
): OperationResult<ModelConfiguration> {
  try {
    const value = configurationSchema.safeParse({
      driver: env.ANTICA_MODEL_DRIVER,
      production: env.NODE_ENV === 'production',
      profiles: env.ANTICA_MODEL_PROFILES_JSON
        ? JSON.parse(env.ANTICA_MODEL_PROFILES_JSON)
        : undefined,
      selections: env.ANTICA_MODEL_SELECTIONS_JSON
        ? JSON.parse(env.ANTICA_MODEL_SELECTIONS_JSON)
        : undefined,
      gatewayApiKey: env.AI_GATEWAY_API_KEY || undefined,
      openAiApiKey: env.OPENAI_API_KEY || undefined,
    });

    return value.success
      ? { success: true, data: value.data }
      : configurationFailure('Model environment configuration is invalid.');
  } catch {
    return configurationFailure(
      'Model profile or selection configuration is not valid JSON.',
    );
  }
}

/**
 * creates role adapters only after checking the full configured role registry
 * @param config typed server configuration
 * @returns configured adapters and selections without selecting an implicit live model
 */
export function createConfiguredModels(
  config: ModelConfiguration,
): OperationResult<ConfiguredModels> {
  if (!configurationSchema.safeParse(config).success) {
    return configurationFailure('Model configuration is invalid.');
  }
  if (config.driver === 'development') {
    if (config.production) {
      return configurationFailure(
        'Development models cannot be enabled in production.',
      );
    }
    const models = createDevelopmentModels();

    return {
      success: true,
      data: {
        models,
        selections: {
          analysis: {
            role: 'analysis',
            modelId: 'development:evidence-v1',
            profileVersion: 'development-v1',
          },
          research: {
            role: 'research',
            modelId: 'development:evidence-v1',
            profileVersion: 'development-v1',
          },
          recordEditing: {
            role: 'recordEditing',
            modelId: 'development:evidence-v1',
            profileVersion: 'development-v1',
          },
          transcription: {
            role: 'transcription',
            modelId: 'development:transcription',
            profileVersion: 'development-v1',
          },
        },
      },
    };
  }
  if (!config.profiles?.length || !config.selections) {
    return configurationFailure(
      'Live models require an explicit profile registry and all four role selections.',
    );
  }
  if (
    new Set(config.profiles.map((profile) => profile.modelId)).size !==
      config.profiles.length ||
    config.profiles.some((profile) => profile.adapterKind !== 'live')
  ) {
    return configurationFailure(
      'Live profile IDs must be unique and every profile must use the live adapter.',
    );
  }
  for (const role of roles) {
    const selection = config.selections[role];
    const selected = resolveModel(
      config.profiles,
      selection,
      requirements[role],
    );
    if (!selected.ok) {
      return {
        success: false,
        error: {
          code: selected.code,
          message: selected.message,
          retryable: false,
        },
      };
    }
    if (selection.role !== role || !selection.profileVersion.trim()) {
      return configurationFailure(
        'Each role requires its own matching selection and pinned profile version.',
      );
    }
    if (
      role === 'transcription'
        ? !selection.modelId.startsWith('openai:') ||
          !config.openAiApiKey?.trim()
        : !selection.modelId.startsWith('gateway:') ||
          !config.gatewayApiKey?.trim()
    ) {
      return configurationFailure(
        `The ${role} provider binding and credential must be configured explicitly.`,
      );
    }
  }

  return {
    success: true,
    data: {
      models: createAiSdkModels({ ...config, profiles: config.profiles }),
      selections: config.selections,
    },
  };
}

/**
 * reports an invalid server model configuration
 * @param message configuration failure detail
 * @returns non-retryable configuration failure
 */
function configurationFailure(message: string): OperationResult<never> {
  return {
    success: false,
    error: { code: 'PROVIDER_UNAVAILABLE', message, retryable: false },
  };
}
