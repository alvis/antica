import { describe, expect, it } from 'vitest';

import { createConfiguredModels, readModelConfiguration } from './config.js';

import type { ModelConfiguration, ModelSelections } from './config.js';

const selections: ModelSelections = {
  analysis: {
    role: 'analysis',
    modelId: 'gateway:test-model',
    profileVersion: '1',
  },
  research: {
    role: 'research',
    modelId: 'gateway:test-model',
    profileVersion: '1',
  },
  recordEditing: {
    role: 'recordEditing',
    modelId: 'gateway:test-model',
    profileVersion: '1',
  },
  transcription: {
    role: 'transcription',
    modelId: 'openai:test-audio',
    profileVersion: '1',
  },
};
const liveConfig: ModelConfiguration = {
  driver: 'live',
  production: true,
  selections,
  gatewayApiKey: 'test-gateway-secret',
  openAiApiKey: 'test-openai-secret',
  profiles: [
    {
      modelId: 'gateway:test-model',
      provider: 'gateway',
      providerModelVersion: '1',
      adapterKind: 'live',
      roles: ['analysis', 'research', 'recordEditing'],
      capabilities: {
        textInput: true,
        imageInput: true,
        audioInput: false,
        structuredOutput: true,
        toolCalling: false,
      },
    },
    {
      modelId: 'openai:test-audio',
      provider: 'openai',
      providerModelVersion: '1',
      adapterKind: 'live',
      roles: ['transcription'],
      capabilities: {
        textInput: false,
        imageInput: false,
        audioInput: true,
        structuredOutput: true,
        toolCalling: false,
      },
    },
  ],
};

describe('fn:readModelConfiguration', () => {
  it('should parse a full live registry and keep provider credentials server-side', () => {
    const result = readModelConfiguration({
      ANTICA_MODEL_DRIVER: 'live',
      NODE_ENV: 'production',
      ANTICA_MODEL_PROFILES_JSON: JSON.stringify(liveConfig.profiles),
      ANTICA_MODEL_SELECTIONS_JSON: JSON.stringify(selections),
      AI_GATEWAY_API_KEY: 'test-gateway-secret',
      OPENAI_API_KEY: 'test-openai-secret',
    });

    expect(result).toEqual({ success: true, data: liveConfig });
  });

  it.each([undefined, 'automatic'])(
    'should reject an absent or unrecognized explicit driver: %s',
    (driver) => {
      expect(
        readModelConfiguration({ ANTICA_MODEL_DRIVER: driver }),
      ).toMatchObject({
        success: false,
        error: { code: 'PROVIDER_UNAVAILABLE' },
      });
    },
  );

  it('should reject malformed profile JSON without exposing supplied credentials', () => {
    const result = readModelConfiguration({
      ANTICA_MODEL_DRIVER: 'live',
      ANTICA_MODEL_PROFILES_JSON: '{',
      AI_GATEWAY_API_KEY: 'private-test-credential',
    });
    expect(result).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE' },
    });
    expect(JSON.stringify(result)).not.toContain('private-test-credential');
  });
});

describe('fn:createConfiguredModels', () => {
  it('should bind each live role to its selected registered provider', () => {
    const result = createConfiguredModels(liveConfig);

    expect(result).toMatchObject({
      success: true,
      data: { selections },
    });
    if (!result.success) {
      throw new Error('Expected a configured live catalog');
    }
    expect(result.data.models.profiles).toEqual(liveConfig.profiles);
  });

  it('should reject a live catalog with duplicate model identities', () => {
    const result = createConfiguredModels({
      ...liveConfig,
      profiles: [...liveConfig.profiles!, liveConfig.profiles![0]!],
    });

    expect(result).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE', retryable: false },
    });
  });

  it('should reject a malformed profile even when the development driver is selected', () => {
    const result = createConfiguredModels({
      driver: 'development',
      production: false,
      profiles: [{ ...liveConfig.profiles![0]!, provider: '' }],
    });

    expect(result).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE', retryable: false },
    });
  });

  it('should reject a selected analysis model without image input capability', () => {
    const visualProfile = liveConfig.profiles![0]!;
    const result = createConfiguredModels({
      ...liveConfig,
      profiles: [
        {
          ...visualProfile,
          capabilities: { ...visualProfile.capabilities, imageInput: false },
        },
        liveConfig.profiles![1]!,
      ],
    });

    expect(result).toMatchObject({
      success: false,
      error: { code: 'MODEL_CAPABILITY_MISMATCH', retryable: false },
    });
  });

  it('should reject a live selection without a pinned profile version', () => {
    const result = createConfiguredModels({
      ...liveConfig,
      selections: {
        ...selections,
        analysis: { ...selections.analysis, profileVersion: ' ' },
      },
    });

    expect(result).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE', retryable: false },
    });
  });

  it('should reject development adapters in production while preserving explicit development selection locally', () => {
    expect(
      createConfiguredModels({ driver: 'development', production: true }),
    ).toMatchObject({ success: false });
    expect(
      createConfiguredModels({ driver: 'development', production: false }),
    ).toMatchObject({
      success: true,
      data: {
        selections: { analysis: { modelId: 'development:evidence-v1' } },
      },
    });
  });

  it('should reject live startup without a full role registry', () => {
    expect(
      createConfiguredModels({ driver: 'live', production: true }),
    ).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE' },
    });
  });

  it.each(['gatewayApiKey', 'openAiApiKey'] as const)(
    'should reject the selected live role when %s is missing',
    (missingCredential) => {
      const result = createConfiguredModels({
        ...liveConfig,
        [missingCredential]: undefined,
      });
      expect(result).toMatchObject({
        success: false,
        error: { code: 'PROVIDER_UNAVAILABLE' },
      });
      expect(JSON.stringify(result)).not.toContain('test-gateway-secret');
      expect(JSON.stringify(result)).not.toContain('test-openai-secret');
    },
  );
});
