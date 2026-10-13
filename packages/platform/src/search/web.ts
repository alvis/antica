import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

import Exa from 'exa-js';

import type { PublicWebResearchPort } from '@antica/application/ports';
import type { SourceCitation } from '@antica/domain';

/** supplies the server-side Exa credential for explicitly requested research */
export interface ExaWebResearchParams {
  readonly apiKey?: string;
}

/**
 * creates an explicit public research boundary with no arbitrary URL fetching
 * @param params server credential
 * @returns public web research adapter
 */
export function createExaWebResearch(
  params: ExaWebResearchParams,
): PublicWebResearchPort {
  return {
    search: async (instructionZhHant) => {
      if (!params.apiKey) {
        return {
          success: false,
          error: {
            code: 'PROVIDER_UNAVAILABLE',
            message: 'Public web research requires an Exa API key.',
            retryable: false,
          },
        };
      }
      if (!instructionZhHant.trim()) {
        return {
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Public research requires an explicit instruction.',
            retryable: false,
          },
        };
      }
      try {
        const provider = new Exa(params.apiKey);
        const result = await provider.search(instructionZhHant, {
          type: 'auto',
          numResults: 10,
          contents: { text: { maxCharacters: 12_000 } },
        });
        const retrievedAt = new Date().toISOString();
        const citations = result.results
          .filter((source) => isPublicSourceUrl(source.url))
          .map((source): SourceCitation => ({
            id: randomUUID(),
            relation: 'background',
            availability: 'link_only',
            verification: source.text ? 'located' : 'needs_review',
            locator: {
              kind: 'web',
              sourceId: sourceIdentity(source.url),
              sourceVersionId: randomUUID(),
              url: source.url,
              retrievedAt,
              snapshotAssetId: null,
              blockId: null,
              excerptAsRetrieved: source.text,
            },
          }));

        return { success: true, data: citations };
      } catch (cause) {
        return {
          success: false,
          error: {
            code: 'PROVIDER_UNAVAILABLE',
            message: 'Public web research could not complete.',
            retryable: true,
          },
          cause,
        };
      }
    },
  };
}

/**
 * limits source links to public HTTP(S) hostnames
 * @param address untrusted source URL
 * @returns whether the address is an acceptable public source link
 */
export function isPublicSourceUrl(address: string): boolean {
  try {
    const url = new URL(address);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');

    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.port &&
      hostname.includes('.') &&
      !hostname.startsWith('[') &&
      isIP(hostname) === 0 &&
      ![
        'localhost',
        'local',
        'internal',
        'lan',
        'home',
        'test',
        'invalid',
      ].some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))
    );
  } catch {
    return false;
  }
}

/**
 * derives a repeatable source identifier from the returned public URL
 * @param address public source URL
 * @returns stable source identifier
 */
function sourceIdentity(address: string): string {
  const digest = createHash('sha256').update(address).digest('hex');

  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
