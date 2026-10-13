import { randomUUID } from 'node:crypto';

import LlamaCloud from '@llamaindex/llama-cloud';

import { createLocalSourceParser } from './local.js';

import type {
  DurableSourceParsingPort,
  OperationResult,
  SourceParsingProgress,
} from '@antica/application/ports';
import type { SourceRegion } from '@antica/domain';

import type { LocalSourceParserParams } from './local.js';

/** configures bounded LlamaParse jobs with authorized originals and durable artifacts */
export interface LlamaSourceParserParams extends LocalSourceParserParams {
  readonly apiKey?: string;
  readonly parserVersion: string;
  readonly webhook?: { readonly url: string; readonly signingSecret: string };
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * submits and resumes one durable LlamaParse job without holding a polling loop
 * @param params provider credential, pinned parser version, and local artifact access
 * @returns durable parsing adapter
 */
export function createLlamaSourceParser(
  params: LlamaSourceParserParams,
): DurableSourceParsingPort {
  const configured = () =>
    !!params.apiKey?.trim() &&
    !!params.parserVersion.trim() &&
    params.parserVersion !== 'latest';
  const client = () =>
    new LlamaCloud({
      apiKey: params.apiKey,
      maxRetries: 0,
      timeout: 30_000,
      logLevel: 'off',
      fetch: params.fetch,
    });

  return {
    submit: async (input) => {
      if (!configured()) {
        return parsingFailure(
          'LlamaParse requires a credential and pinned parser version.',
          false,
        );
      }
      try {
        const asset = await params.readAsset(input.originalAssetId);
        const extensions: Record<string, string> = {
          'application/pdf': 'pdf',
          'image/jpeg': 'jpg',
          'image/png': 'png',
          'image/webp': 'webp',
          'image/tiff': 'tiff',
        };
        const extension = extensions[asset.mimeType];
        if (!extension) {
          return {
            success: false,
            error: {
              code: 'MEDIA_UNSUPPORTED',
              message: 'LlamaParse accepts PDF and photographed book pages.',
              retryable: false,
            },
          };
        }
        const job = await client().parsing.create({
          tier: 'agentic',
          version: params.parserVersion,
          webhook_configurations: params.webhook
            ? [
                {
                  webhook_url: params.webhook.url,
                  webhook_signing_secret: params.webhook.signingSecret,
                  webhook_output_format: 'json',
                  webhook_events: [
                    'parse.success',
                    'parse.error',
                    'parse.partial_success',
                    'parse.cancelled',
                  ],
                },
              ]
            : undefined,
          upload_file: new File(
            [new Uint8Array(asset.bytes)],
            `${asset.id}.${extension}`,
            { type: asset.mimeType },
          ),
        });
        if (!job.id || job.status === 'FAILED' || job.status === 'CANCELLED') {
          return parsingFailure(
            'LlamaParse did not accept the parsing job.',
            false,
          );
        }

        return {
          success: true,
          data: {
            ...input,
            kind: 'waiting',
            provider: 'llama-parse',
            providerJobId: job.id,
            resumeAfter: new Date(Date.now() + 5000).toISOString(),
          },
        };
      } catch (cause) {
        return parsingFailure(
          'The LlamaParse job could not be submitted.',
          true,
          cause,
        );
      }
    },
    resume: async (handle) => {
      if (!configured()) {
        return parsingFailure(
          'LlamaParse requires a credential and pinned parser version.',
          false,
        );
      }
      if (handle.provider !== 'llama-parse' || !handle.providerJobId) {
        return parsingFailure(
          'The parse handle does not belong to LlamaParse.',
          false,
        );
      }
      try {
        const result = await client().parsing.get(handle.providerJobId, {
          expand: ['text', 'items', 'job_metadata'],
        });
        if (result.job.id !== handle.providerJobId) {
          return parsingFailure(
            'The provider returned a different parsing job.',
            false,
          );
        }
        if (
          result.job.status === 'PENDING' ||
          result.job.status === 'RUNNING'
        ) {
          return {
            success: true,
            data: {
              ...handle,
              kind: 'waiting',
              resumeAfter: new Date(Date.now() + 5000).toISOString(),
            },
          };
        }
        const rawOutputAssetId = await params.writeArtifact(
          new TextEncoder().encode(
            JSON.stringify({
              job: result.job,
              text: result.text,
              items: result.items,
            }),
          ),
          'application/json',
        );
        if (result.job.status !== 'COMPLETED' || !result.text?.pages) {
          return parsingFailure(
            'LlamaParse did not return completed page text.',
            false,
          );
        }
        const local = await createLocalSourceParser(params).parse({
          sourceVersionId: handle.sourceVersionId,
          parseRunId: handle.parseRunId,
          originalAssetIds: [handle.originalAssetId],
        });
        if (!local.success) {
          return local;
        }
        const textPages = new Map(
          result.text.pages.map((page) => [page.page_number, page.text]),
        );
        if (
          textPages.size !== result.text.pages.length ||
          textPages.size !== local.data.pages.length ||
          local.data.pages.some(
            (page) => !textPages.has((page.pdfPageIndex ?? 0) + 1),
          )
        ) {
          return parsingFailure(
            'Provider page numbers cannot be mapped completely to the original document.',
            false,
          );
        }
        const pages = local.data.pages.map((page) => {
          const rawText = textPages.get((page.pdfPageIndex ?? 0) + 1)!;

          return {
            ...page,
            rawText,
            searchText: rawText.normalize('NFKC').toLocaleLowerCase('zh-Hant'),
            quality: 'needs_review' as const,
            regionIds: rawText.trim() ? [randomUUID()] : [],
          };
        });
        const regions: SourceRegion[] = pages.flatMap((page) =>
          page.regionIds.map((id) => ({
            id,
            sourceVersionId: handle.sourceVersionId,
            pageId: page.id,
            kind: 'text',
            region: { kind: 'rect', x: 0, y: 0, width: 1, height: 1 },
            rawText: page.rawText,
            relatedRegionIds: [],
          })),
        );

        return {
          success: true,
          data: {
            kind: 'completed',
            pack: {
              ...local.data,
              rawOutputAssetId,
              pages,
              regions,
              warnings: pages.map((page) => ({
                pageId: page.id,
                messageZhHant:
                  '解析文字尚待核對原頁；文字區域代表整頁，不是已驗證的 OCR 邊界。 / Verify parsed text against the original; text regions cover the whole page, not verified OCR bounds. 供應商圖版及邊界資料保存在原始解析檔，尚未驗證為原頁定位或保存圖像。 / Provider figure and bounds data remain in the raw parse artifact; original-page mapping and image retention are incomplete.',
              })),
            },
          },
        };
      } catch (cause) {
        return parsingFailure(
          'The LlamaParse result could not be retrieved or retained.',
          true,
          cause,
        );
      }
    },
  };
}

/**
 * reports a bounded parsing failure without substituting source content
 * @param message failure detail
 * @param retryable whether the provider operation can be retried
 * @param cause optional internal diagnostic cause
 * @returns source parsing failure
 */
function parsingFailure(
  message: string,
  retryable: boolean,
  cause?: unknown,
): OperationResult<SourceParsingProgress> {
  return {
    success: false,
    error: { code: 'SOURCE_UNAVAILABLE', message, retryable },
    cause,
  };
}
