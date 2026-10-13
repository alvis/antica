import { describe, expect, it } from 'vitest';

import { resolveModel } from './capability.js';

import type { ModelCapabilities, ModelSelection } from '@antica/contracts';

import type { ModelProfile } from './capability.js';

const capabilities: ModelCapabilities = {
  textInput: true,
  imageInput: true,
  audioInput: false,
  structuredOutput: true,
  toolCalling: false,
  maxImages: 6,
  maxContextTokens: 1000,
};
const profile: ModelProfile = {
  modelId: 'provider:vision-a',
  provider: 'provider',
  providerModelVersion: null,
  adapterKind: 'live',
  roles: ['analysis'],
  capabilities,
};
const selection: ModelSelection = {
  role: 'analysis',
  modelId: profile.modelId,
  profileVersion: 'v1',
};

describe('fn:resolveModel', () => {
  it('should switch compatible providers by model ID without changing the analysis contract', () => {
    const alternative: ModelProfile = {
      ...profile,
      modelId: 'other:vision-b',
      provider: 'other',
    };
    const profiles = [profile, alternative];
    const required = { imageInput: true, structuredOutput: true, maxImages: 6 };

    const first = resolveModel(profiles, selection, required);
    const second = resolveModel(
      profiles,
      { ...selection, modelId: alternative.modelId },
      required,
    );

    expect(first).toEqual({ ok: true, profile });
    expect(second).toEqual({ ok: true, profile: alternative });
  });

  it('should reject an unknown model instead of choosing the first registered provider', () => {
    const result = resolveModel(
      [profile],
      { ...selection, modelId: 'unknown:vision' },
      {},
    );

    expect(result).toMatchObject({ ok: false, code: 'MODEL_UNKNOWN' });
  });

  it('should reject a model registered only for a different role', () => {
    const result = resolveModel(
      [profile],
      { ...selection, role: 'transcription' },
      {},
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'MODEL_CAPABILITY_MISMATCH',
    });
  });

  it('should reject text-only inference when frozen evidence includes photos', () => {
    const textOnly = {
      ...profile,
      capabilities: { ...capabilities, imageInput: false },
    };

    const result = resolveModel([textOnly], selection, { imageInput: true });

    expect(result).toMatchObject({
      ok: false,
      code: 'MODEL_CAPABILITY_MISMATCH',
    });
  });

  it('should reject unsupported structured output before invocation', () => {
    const freeText = {
      ...profile,
      capabilities: { ...capabilities, structuredOutput: false },
    };

    const result = resolveModel([freeText], selection, {
      structuredOutput: true,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'MODEL_CAPABILITY_MISMATCH',
    });
  });

  it('should reject oversized evidence instead of silently dropping an image', () => {
    const result = resolveModel([profile], selection, { maxImages: 7 });

    expect(result).toMatchObject({
      ok: false,
      code: 'MODEL_CAPABILITY_MISMATCH',
    });
  });

  it('should reject a source pack that exceeds the registered context window', () => {
    const result = resolveModel([profile], selection, {
      maxContextTokens: 1001,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'MODEL_CAPABILITY_MISMATCH',
    });
  });
});
