import { describe, expect, it } from 'vitest';

import {
  createConfiguredKnowledgeAdapters,
  readKnowledgeConfiguration,
} from './config.js';

const live = {
  NODE_ENV: 'production',
  ANTICA_PARSING_DRIVER: 'llama',
  ANTICA_TEXT_SEARCH_DRIVER: 'llama',
  LLAMA_CLOUD_API_KEY: 'test-key',
  LLAMA_PARSE_VERSION: '2026-01-01',
  LLAMA_CLOUD_INDEX_ID: 'index',
  LLAMA_CLOUD_SOURCE_DIRECTORY_ID: 'directory',
  LLAMA_TEXT_EMBEDDING_MODEL_ID: 'embedding',
  LLAMA_TEXT_DIMENSIONS: '8',
  ANTICA_TEXT_INDEX_VERSION: 'v1',
  EXA_API_KEY: 'test-exa',
};

describe('fn:readKnowledgeConfiguration', () => {
  it('should retain explicit independent live drivers and embedding space', () => {
    expect(readKnowledgeConfiguration(live)).toEqual({
      success: true,
      data: {
        production: true,
        parsingDriver: 'llama',
        textDriver: 'llama',
        llamaApiKey: 'test-key',
        parserVersion: '2026-01-01',
        indexId: 'index',
        sourceDirectoryId: 'directory',
        textIndex: {
          embeddingModelId: 'embedding',
          dimensions: 8,
          indexVersion: 'v1',
        },
        exaApiKey: 'test-exa',
      },
    });
  });

  it.each([
    { ANTICA_PARSING_DRIVER: '' },
    { ANTICA_TEXT_SEARCH_DRIVER: 'unknown' },
    { ANTICA_PARSING_DRIVER: 'local' },
    { ANTICA_TEXT_SEARCH_DRIVER: 'local' },
    { LLAMA_CLOUD_API_KEY: '' },
    { LLAMA_PARSE_VERSION: 'latest' },
    { LLAMA_PARSE_VERSION: '' },
    { LLAMA_CLOUD_INDEX_ID: '' },
    { LLAMA_CLOUD_SOURCE_DIRECTORY_ID: '' },
    { LLAMA_TEXT_EMBEDDING_MODEL_ID: '' },
    { LLAMA_TEXT_DIMENSIONS: '0' },
    { LLAMA_TEXT_DIMENSIONS: '8.5' },
    { ANTICA_TEXT_INDEX_VERSION: '' },
    { EXA_API_KEY: '' },
  ])('should fail incomplete or unsafe live configuration %#', (override) => {
    expect(readKnowledgeConfiguration({ ...live, ...override })).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE', retryable: false },
    });
  });

  it('should permit explicitly selected local development adapters without provider credentials', () => {
    expect(
      readKnowledgeConfiguration({
        ANTICA_PARSING_DRIVER: 'local',
        ANTICA_TEXT_SEARCH_DRIVER: 'local',
      }),
    ).toEqual({
      success: true,
      data: {
        production: false,
        parsingDriver: 'local',
        textDriver: 'local',
        textIndex: {
          embeddingModelId: 'development:lexical-v1',
          dimensions: 1,
          indexVersion: 'lexical-v1',
        },
      },
    });
  });
});

const localParsing = {
  driver: 'local' as const,
  readAsset: async () => {
    throw new Error('Unused asset');
  },
  resolveSource: async () => ({ sourceId: 'source' }),
  writeArtifact: async () => 'artifact',
};
const localText = {
  driver: 'local' as const,
  index: {
    embeddingModelId: 'development:lexical-v1',
    dimensions: 1,
    indexVersion: 'lexical-v1',
  },
  readEntries: async () => [],
};
const liveParsing = {
  ...localParsing,
  driver: 'llama' as const,
  apiKey: 'test-key',
  parserVersion: '2026-01-01',
};
const liveText = {
  driver: 'llama' as const,
  ownerId: 'owner',
  apiKey: 'test-key',
  indexId: 'index',
  index: localText.index,
  resolveChunk: async () => null,
};
const writer = {
  submit: async () => ({
    success: true as const,
    data: { kind: 'completed' as const, mappings: [], indexedCount: 0 },
  }),
  resume: async () => ({
    success: true as const,
    data: { kind: 'completed' as const, mappings: [], indexedCount: 0 },
  }),
};

describe('fn:createConfiguredKnowledgeAdapters', () => {
  it('should create explicitly local development adapters whose empty search stays empty', async () => {
    const result = createConfiguredKnowledgeAdapters({
      production: false,
      parsing: localParsing,
      text: localText,
      web: {},
    });

    if (!result.success) {
      throw new Error('Expected local adapters');
    }
    expect(
      await result.data.text.snapshot('glaze', localText.index),
    ).toMatchObject({ success: true, data: { citations: [], text: [] } });
  });

  it('should retain the explicitly configured live writer', () => {
    const result = createConfiguredKnowledgeAdapters({
      production: true,
      parsing: liveParsing,
      text: liveText,
      web: { apiKey: 'test-exa' },
      textIndexWriter: writer,
    });

    expect(result).toMatchObject({
      success: true,
      data: { textIndexWriter: writer },
    });
  });

  it.each([
    { parsing: localParsing },
    { text: localText },
    { parsing: { ...liveParsing, apiKey: '' } },
    { parsing: { ...liveParsing, parserVersion: '' } },
    { parsing: { ...liveParsing, parserVersion: 'latest' } },
    { text: { ...liveText, apiKey: '' } },
    { text: { ...liveText, indexId: '' } },
    { web: {} },
  ])('should reject unavailable production adapters %#', (override) => {
    const result = createConfiguredKnowledgeAdapters({
      production: true,
      parsing: liveParsing,
      text: liveText,
      web: { apiKey: 'test-exa' },
      textIndexWriter: writer,
      ...override,
    });

    expect(result).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE', retryable: false },
    });
  });

  it('should reject live retrieval without its durable writer', () => {
    const result = createConfiguredKnowledgeAdapters({
      production: true,
      parsing: liveParsing,
      text: liveText,
      web: { apiKey: 'test-exa' },
    });

    expect(result).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE', retryable: false },
    });
  });
});

describe('Llama webhook startup configuration', () => {
  it.each([
    { LLAMA_WEBHOOK_URL: 'https://example.org/callback' },
    { LLAMA_WEBHOOK_SIGNING_SECRET: 'test-secret' },
    {
      LLAMA_WEBHOOK_URL: 'http://example.org/callback',
      LLAMA_WEBHOOK_SIGNING_SECRET: 'test-secret',
    },
    {
      LLAMA_WEBHOOK_URL: 'https://example.org/callback',
      LLAMA_WEBHOOK_SIGNING_SECRET: ' ',
    },
  ])('should reject an incomplete or insecure webhook pair %#', (webhook) => {
    expect(readKnowledgeConfiguration({ ...live, ...webhook })).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE', retryable: false },
    });
  });

  it('should retain an HTTPS callback and its paired signing secret', () => {
    expect(
      readKnowledgeConfiguration({
        ...live,
        LLAMA_WEBHOOK_URL: 'https://example.org/callback',
        LLAMA_WEBHOOK_SIGNING_SECRET: 'test-secret',
      }),
    ).toMatchObject({
      success: true,
      data: {
        webhook: {
          url: 'https://example.org/callback',
          signingSecret: 'test-secret',
        },
      },
    });
  });
});
