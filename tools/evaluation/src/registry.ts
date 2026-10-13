import { z } from 'zod';

import { modelCapabilitiesSchema, modelRoleSchema } from '@antica/contracts';
import { createAiSdkModels } from '@antica/platform/ai';

import { readFile } from 'node:fs/promises';

import type { ModelAdapters } from '@antica/platform/ai';

const registrySchema = z
  .strictObject({
    profiles: z
      .array(
        z.strictObject({
          modelId: z.string().min(1),
          provider: z.string().min(1),
          providerModelVersion: z.string().nullable(),
          adapterKind: z.literal('live'),
          roles: z.array(modelRoleSchema),
          capabilities: modelCapabilitiesSchema,
        }),
      )
      .min(1),
  })
  .refine(
    (config) =>
      new Set(config.profiles.map((profile) => profile.modelId)).size ===
      config.profiles.length,
    'Registry model IDs must be unique',
  );

/**
 * loads explicit live model registrations without recording server credentials
 * @param path JSON registry configuration
 * @returns live capability-gated model ports, with no development fallback
 */
export async function readLiveRegistry(path: string): Promise<ModelAdapters> {
  const config = registrySchema.parse(JSON.parse(await readFile(path, 'utf8')));

  return createAiSdkModels({
    profiles: config.profiles,
    gatewayApiKey: process.env.AI_GATEWAY_API_KEY,
  });
}
