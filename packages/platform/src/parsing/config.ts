import { z } from 'zod';

import { createLlamaTextRetrieval } from '../search/llama.js';
import {
  createLocalTextRetrieval,
  developmentTextIndex,
} from '../search/text.js';
import { createExaWebResearch } from '../search/web.js';

import { createLlamaSourceParser } from './llama.js';
import { createLocalSourceParser } from './local.js';

import type {
  DurableSourceParsingPort,
  DurableTextIndexWriterPort,
  IndexIdentity,
  OperationResult,
  PublicWebResearchPort,
  SourceParsingPort,
  TextRetrievalPort,
} from '@antica/application/ports';

import type { LlamaTextRetrievalParams } from '../search/llama.js';
import type { LocalTextRetrievalParams } from '../search/text.js';
import type { ExaWebResearchParams } from '../search/web.js';

import type { LlamaSourceParserParams } from './llama.js';
import type { LocalSourceParserParams } from './local.js';

/** keeps parsing and text drivers independent of the inference driver */
export interface ConfiguredKnowledgeAdaptersParams {
  readonly production: boolean;
  readonly parsing:
    | ({ readonly driver: 'local' } & LocalSourceParserParams)
    | ({ readonly driver: 'llama' } & LlamaSourceParserParams);
  readonly text:
    | ({ readonly driver: 'local' } & LocalTextRetrievalParams)
    | ({ readonly driver: 'llama' } & LlamaTextRetrievalParams);
  readonly web: ExaWebResearchParams;
  readonly textIndexWriter?: DurableTextIndexWriterPort;
}
/** groups source adapters after startup configuration validation */
export interface ConfiguredKnowledgeAdapters {
  readonly parser: SourceParsingPort | DurableSourceParsingPort;
  readonly text: TextRetrievalPort;
  readonly web: PublicWebResearchPort;
  readonly textIndexWriter?: DurableTextIndexWriterPort;
}

/**
 * creates independently selected source adapters with explicit startup failures
 * @param params provider settings and authorized persistence callbacks
 * @returns configured source adapters without implicit fallback
 */
export function createConfiguredKnowledgeAdapters(
  params: ConfiguredKnowledgeAdaptersParams,
): OperationResult<ConfiguredKnowledgeAdapters> {
  if (
    params.production &&
    (params.parsing.driver === 'local' || params.text.driver === 'local')
  ) {
    return unavailable(
      'Production requires live parsing and text-search adapters.',
    );
  }
  if (
    params.parsing.driver === 'llama' &&
    (!params.parsing.apiKey?.trim() ||
      !params.parsing.parserVersion.trim() ||
      params.parsing.parserVersion === 'latest')
  ) {
    return unavailable(
      'LlamaParse requires a credential and pinned parser version.',
    );
  }
  if (
    params.text.driver === 'llama' &&
    (!params.text.apiKey?.trim() ||
      !params.text.indexId.trim() ||
      !params.textIndexWriter)
  ) {
    return unavailable(
      'LlamaCloud requires a credential, index ID, and durable index writer.',
    );
  }
  if (params.production && !params.web.apiKey?.trim()) {
    return unavailable(
      'Public web research requires the Exa credential in production.',
    );
  }

  return {
    success: true,
    data: {
      parser:
        params.parsing.driver === 'local'
          ? createLocalSourceParser(params.parsing)
          : createLlamaSourceParser(params.parsing),
      text:
        params.text.driver === 'local'
          ? createLocalTextRetrieval(params.text)
          : createLlamaTextRetrieval(params.text),
      web: createExaWebResearch(params.web),
      textIndexWriter: params.textIndexWriter,
    },
  };
}

/**
 * reports an unusable source-adapter configuration
 * @param message configuration failure detail
 * @returns non-retryable startup failure
 */
function unavailable(message: string): OperationResult<never> {
  return {
    success: false,
    error: { code: 'PROVIDER_UNAVAILABLE', message, retryable: false },
  };
}

/** captures validated startup values before persistence callbacks are assembled */
export interface KnowledgeConfiguration {
  readonly production: boolean;
  readonly parsingDriver: 'local' | 'llama';
  readonly textDriver: 'local' | 'llama';
  readonly llamaApiKey?: string;
  readonly parserVersion?: string;
  readonly webhook?: NonNullable<LlamaSourceParserParams['webhook']>;
  readonly indexId?: string;
  readonly sourceDirectoryId?: string;
  readonly textIndex: IndexIdentity;
  readonly exaApiKey?: string;
}

/**
 * reads independent parsing, text, and web startup settings
 * @param env explicit server environment values
 * @returns configuration with a declared index identity or a startup failure
 */
export function readKnowledgeConfiguration(
  env: Readonly<Record<string, string | undefined>>,
): OperationResult<KnowledgeConfiguration> {
  const driver = z.enum(['local', 'llama']);
  const parsing = driver.safeParse(env.ANTICA_PARSING_DRIVER);
  const text = driver.safeParse(env.ANTICA_TEXT_SEARCH_DRIVER);
  if (!parsing.success || !text.success) {
    return unavailable(
      'ANTICA_PARSING_DRIVER and ANTICA_TEXT_SEARCH_DRIVER must explicitly be local or llama.',
    );
  }
  const webhookUrl = env.LLAMA_WEBHOOK_URL;
  const webhookSecret = env.LLAMA_WEBHOOK_SIGNING_SECRET;
  if (
    (webhookUrl || webhookSecret) &&
    (!webhookSecret?.trim() ||
      !webhookUrl ||
      !z.url({ protocol: /^https$/ }).safeParse(webhookUrl).success)
  ) {
    return unavailable(
      'Llama webhooks require an HTTPS callback URL and paired signing secret.',
    );
  }
  const production = env.NODE_ENV === 'production';
  if (production && (parsing.data === 'local' || text.data === 'local')) {
    return unavailable(
      'Local parsing and text search are unavailable in production.',
    );
  }
  if (
    (parsing.data === 'llama' || text.data === 'llama') &&
    !env.LLAMA_CLOUD_API_KEY?.trim()
  ) {
    return unavailable(
      'LLAMA_CLOUD_API_KEY is required for the selected source adapter.',
    );
  }
  if (
    parsing.data === 'llama' &&
    (!env.LLAMA_PARSE_VERSION?.trim() || env.LLAMA_PARSE_VERSION === 'latest')
  ) {
    return unavailable('LLAMA_PARSE_VERSION must pin a parser version.');
  }
  const liveIndex = z
    .strictObject({
      embeddingModelId: z.string().trim().min(1),
      dimensions: z.number().int().positive(),
      indexVersion: z.string().trim().min(1),
    })
    .safeParse({
      embeddingModelId: env.LLAMA_TEXT_EMBEDDING_MODEL_ID,
      dimensions: Number(env.LLAMA_TEXT_DIMENSIONS),
      indexVersion: env.ANTICA_TEXT_INDEX_VERSION,
    });
  if (
    text.data === 'llama' &&
    (!liveIndex.success ||
      !env.LLAMA_CLOUD_INDEX_ID?.trim() ||
      !env.LLAMA_CLOUD_SOURCE_DIRECTORY_ID?.trim())
  ) {
    return unavailable(
      'LlamaCloud requires index/source-directory IDs and an explicit text embedding model, dimensions, and index version.',
    );
  }
  if (production && !env.EXA_API_KEY?.trim()) {
    return unavailable(
      'EXA_API_KEY is required for public web research in production.',
    );
  }

  return {
    success: true,
    data: {
      production,
      parsingDriver: parsing.data,
      webhook:
        webhookUrl && webhookSecret
          ? { url: webhookUrl, signingSecret: webhookSecret }
          : undefined,
      textDriver: text.data,
      textIndex:
        text.data === 'llama' && liveIndex.success
          ? liveIndex.data
          : developmentTextIndex,
      llamaApiKey: env.LLAMA_CLOUD_API_KEY || undefined,
      parserVersion: env.LLAMA_PARSE_VERSION || undefined,
      indexId: env.LLAMA_CLOUD_INDEX_ID || undefined,
      sourceDirectoryId: env.LLAMA_CLOUD_SOURCE_DIRECTORY_ID || undefined,
      exaApiKey: env.EXA_API_KEY || undefined,
    },
  };
}
