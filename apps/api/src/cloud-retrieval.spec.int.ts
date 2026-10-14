import { inject, describe, expect, vi } from 'vitest';

import { collectorUserId, readKnowledgeConfiguration } from '@antica/platform';

import { createHttpTest } from './fixtures/http/test.js';
import { createLocalSettings } from './fixtures/runtime.js';

const resources = inject('httpResources');
const settings = createLocalSettings();
const knowledge = readKnowledgeConfiguration({
  ANTICA_PARSING_DRIVER: 'local',
  ANTICA_TEXT_SEARCH_DRIVER: 'llama',
  LLAMA_CLOUD_API_KEY: 'synthetic-test-key',
  LLAMA_CLOUD_INDEX_ID: 'test-index',
  LLAMA_CLOUD_SOURCE_DIRECTORY_ID: 'test-directory',
  LLAMA_TEXT_EMBEDDING_MODEL_ID: 'embedding',
  LLAMA_TEXT_DIMENSIONS: '8',
  ANTICA_TEXT_INDEX_VERSION: 'test-v1',
});
if (!knowledge.success) {
  throw new Error('Invalid test provider config');
}
const it = createHttpTest(resources['cloud-retrieval']!, {
  ...settings,
  knowledge: knowledge.data,
});

describe('Configured cloud text retrieval', () => {
  it('should reject an unmapped provider chunk through the persisted collector mapping lookup', async ({
    fixture,
  }) => {
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({
        results: [
          {
            metadata: {
              anticaOwnerId: collectorUserId,
              anticaIndexVersion: fixture.runtime.textIndex.indexVersion,
            },
            content: 'Provider passage without retained source mapping',
            static_fields: {
              parsed_directory_file_id: 'unmapped-file',
              chunk_index: 0,
            },
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', transport);
    const result = await fixture.runtime.text.snapshot(
      'glaze',
      fixture.runtime.textIndex,
    );
    expect(result).not.toHaveProperty('cause');
    expect(result).toMatchObject({
      success: false,
      error: { code: 'SOURCE_UNAVAILABLE', retryable: false },
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await new Request(...transport.mock.calls[0]!).json()).toMatchObject(
      {
        query: 'glaze',
        index_id: 'test-index',
        custom_filters: {
          anticaOwnerId: {
            operator: 'eq',
            value: collectorUserId,
          },
        },
      },
    );
  });
  it('should return an empty snapshot when the configured provider has no matches', async ({
    fixture,
  }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => Response.json({ results: [] })),
    );
    expect(
      await fixture.runtime.text.snapshot('glaze', fixture.runtime.textIndex),
    ).toMatchObject({
      success: true,
      data: { citations: [], text: [], index: fixture.runtime.textIndex },
    });
  });
});
