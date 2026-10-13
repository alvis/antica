import { createHash } from 'node:crypto';

import { editDraftResultSchema, researchDraftSchema } from '@antica/contracts';

import { resolveModel } from './capability.js';
import { validateGeneratedAnalysis } from './output.js';

import type {
  AnalysisModelPort,
  ModelCatalogPort,
  ModelInvocation,
  OperationResult,
  RecordEditingPort,
  ResearchModelPort,
  TranscriptionPort,
} from '@antica/application/ports';
import type {
  AnalysisOutput,
  Finding,
  ModelCapabilities,
  ModelSelection,
} from '@antica/contracts';

import type { ModelProfile } from './capability.js';

/** supplies all four role boundaries and the public capability catalog */
export interface ModelAdapters {
  readonly profiles: readonly ModelProfile[];
  readonly catalog: ModelCatalogPort;
  readonly analysis: AnalysisModelPort;
  readonly research: ResearchModelPort;
  readonly recordEditing: RecordEditingPort;
  readonly transcription: TranscriptionPort;
}

const developmentCapabilities: ModelCapabilities = {
  textInput: true,
  imageInput: true,
  audioInput: false,
  structuredOutput: true,
  toolCalling: false,
  maxImages: 100,
};
const developmentProfiles: readonly ModelProfile[] = [
  ...['development:evidence-v1', 'development:evidence-v2'].map(
    (modelId): ModelProfile => ({
      modelId,
      provider: 'development',
      providerModelVersion: modelId,
      adapterKind: 'development',
      roles: ['analysis', 'research', 'recordEditing'],
      capabilities: developmentCapabilities,
    }),
  ),
  {
    modelId: 'development:text-only',
    provider: 'development',
    providerModelVersion: '1',
    adapterKind: 'development',
    roles: ['research', 'recordEditing'],
    capabilities: { ...developmentCapabilities, imageInput: false },
  },
  {
    modelId: 'development:transcription',
    provider: 'development',
    providerModelVersion: null,
    adapterKind: 'development',
    roles: ['transcription'],
    capabilities: {
      textInput: false,
      imageInput: false,
      audioInput: true,
      structuredOutput: true,
      toolCalling: false,
    },
  },
];

/**
 * creates visibly labeled deterministic models without visual or authenticity claims
 * @returns development adapters
 */
export function createDevelopmentModels(): ModelAdapters {
  return {
    profiles: developmentProfiles,
    catalog: {
      resolve: async (selection, required) => {
        const result = resolveModel(developmentProfiles, selection, required);

        return result.ok
          ? {
              success: true,
              data: {
                effectiveModelId: result.profile.modelId,
                capabilities: result.profile.capabilities,
              },
            }
          : {
              success: false,
              error: {
                code: result.code,
                message: result.message,
                retryable: false,
              },
            };
      },
    },
    analysis: {
      analyze: async (pack, selection) => {
        const startedAt = performance.now();
        const selected = selectRole(selection, 'analysis', {
          textInput: true,
          imageInput: true,
          structuredOutput: true,
          maxImages: pack.images.length,
        });
        if (!selected.success) {
          return { ...selected, audit: { invocation: null, rawOutput: null } };
        }
        const findings = pack.text.flatMap((item): Finding[] => {
          if (item.kind === 'source') {
            const citation = pack.citations.find(
              (candidate) => candidate.id === item.citationId,
            );
            if (
              !citation ||
              citation.availability === 'unavailable' ||
              citation.verification !== 'located' ||
              !item.contentAsRetrieved.trim()
            ) {
              return [];
            }
            return [
              {
                id: stableId(
                  `${pack.input.snapshotId}:source:${item.citationId}`,
                ),
                kind: 'sourceStatement',
                text: item.contentAsRetrieved,
                evidenceIds: [],
                observationIds: [],
                citationIds: [item.citationId],
                relation: 'context',
                certainty: 'reported',
              },
            ];
          }
          if (item.kind === 'observation') {
            return [
              {
                id: stableId(`${pack.input.snapshotId}:observation:${item.id}`),
                kind: 'collectorObservation',
                text: item.content,
                evidenceIds: [],
                observationIds: [item.id],
                citationIds: [],
                relation: 'context',
                certainty: 'reported',
              },
            ];
          }
          return [];
        });
        const output: AnalysisOutput = {
          summary:
            '開發示範 / Development example: 僅整理已提供的原文，未進行影像鑑賞或真偽判斷。',
          findings,
          uncertainties: [
            '開發模型未判讀照片；缺少資料表示尚未確定，不代表特徵不存在。 / Images were not interpreted; missing evidence remains unknown.',
          ],
          suggestedMethodIds: [],
          nextActions: [
            {
              id: stableId(`${pack.input.snapshotId}:describe`),
              kind: 'describe',
              instruction:
                '記錄現場觀察與尚未確定之處。 / Record your observations and uncertainties.',
              reason:
                '人工實查與模型推測需分開保存。 / Keep collector observations separate from inference.',
            },
          ],
          proposedChanges: findings.some(
            (finding) => finding.kind === 'collectorObservation',
          )
            ? [
                {
                  id: stableId(`${pack.input.snapshotId}:description`),
                  field: 'description',
                  before: pack.recordFields.description,
                  proposed: [
                    pack.recordFields.description,
                    ...findings
                      .filter(
                        (finding) => finding.kind === 'collectorObservation',
                      )
                      .map((finding) => finding.text),
                  ]
                    .filter(Boolean)
                    .join('\n'),
                  findingIds: findings
                    .filter(
                      (finding) => finding.kind === 'collectorObservation',
                    )
                    .map((finding) => finding.id),
                },
              ]
            : [],
        };
        const validated = validateGeneratedAnalysis(output, pack);
        if (!validated.success) {
          return {
            ...validated,
            audit: {
              invocation: {
                ...describeInvocation(
                  selected.data,
                  selection,
                  pack.input.promptVersion,
                  pack.input.schemaVersion,
                  startedAt,
                ),
                citationCheck: { valid: false, rejectedReferenceIds: [] },
              },
              rawOutput: output,
            },
          };
        }

        return {
          success: true,
          data: {
            value: validated.data,
            invocation: describeInvocation(
              selected.data,
              selection,
              pack.input.promptVersion,
              pack.input.schemaVersion,
              startedAt,
            ),
          },
        };
      },
    },
    research: {
      draft: async (request, sources, selection) => {
        const startedAt = performance.now();
        const selected = selectRole(selection, 'research', {
          textInput: true,
          structuredOutput: true,
        });
        if (!selected.success) {
          return { ...selected, audit: { invocation: null, rawOutput: null } };
        }
        const citations = sources.citations.filter(
          (citation) =>
            citation.availability !== 'unavailable' &&
            citation.verification === 'located',
        );
        const allowedIds = new Set(citations.map((citation) => citation.id));
        const value = researchDraftSchema.parse({
          revision: 1,
          titleZhHant: `開發示範 / Development example: ${request.instructionZhHant}`,
          paragraphs: sources.text
            .filter((item) => allowedIds.has(item.citationId))
            .map((item) => ({
              textZhHant: item.contentAsRetrieved,
              citationIds: [item.citationId],
              support: 'cited',
            })),
          citations,
          unresolvedQuestionsZhHant: [
            '以下僅為檢索原文，尚未核對來源分歧或推論。 / Retrieved quotations require collector review.',
          ],
        });

        return {
          success: true,
          data: {
            value,
            invocation: describeInvocation(
              selected.data,
              selection,
              'research-v1',
              'research-v1',
              startedAt,
            ),
          },
        };
      },
    },
    recordEditing: {
      draft: async (request, sourceText, context, selection) => {
        const startedAt = performance.now();
        const selected = selectRole(selection, 'recordEditing', {
          textInput: true,
          structuredOutput: true,
        });
        if (!selected.success) {
          return { ...selected, audit: { invocation: null, rawOutput: null } };
        }
        const description = sourceText.join('\n');
        const value = editDraftResultSchema.parse({
          editDraftId: request.requestKey,
          recordId: request.recordId,
          baseVersions: context.versions,
          sourceTranscriptionIds: request.transcriptionIds,
          sourceObservationIds: request.observationIds,
          suggestedDescriptionZhHant: description,
          proposedChanges:
            description && description !== context.fields.description
              ? [
                  {
                    id: stableId(`${request.requestKey}:description`),
                    field: 'description',
                    before: context.fields.description,
                    proposed: description,
                    findingIds: [],
                  },
                ]
              : [],
        });

        return {
          success: true,
          data: {
            value,
            invocation: describeInvocation(
              selected.data,
              selection,
              'editing-v1',
              'editing-v1',
              startedAt,
            ),
          },
        };
      },
    },
    transcription: {
      transcribe: async (_request, _audio, selection) => {
        const selected = selectRole(selection, 'transcription', {
          audioInput: true,
        });
        if (!selected.success) {
          return { ...selected, audit: { invocation: null, rawOutput: null } };
        }

        return {
          success: false,
          audit: { invocation: null, rawOutput: null },
          error: {
            code: 'PROVIDER_UNAVAILABLE',
            message:
              'No speech transcription provider is configured. No transcript was generated.',
            retryable: false,
          },
        };
      },
    },
  };
}

/**
 * checks a deterministic model against the operation requirements
 * @param selection requested model and role
 * @param role required operation role
 * @param required input and output capability requirements
 * @returns compatible development profile or explicit rejection
 */
function selectRole(
  selection: ModelSelection,
  role: ModelSelection['role'],
  required: Partial<ModelCapabilities>,
): OperationResult<ModelProfile> {
  if (selection.role !== role) {
    return {
      success: false,
      error: {
        code: 'MODEL_CAPABILITY_MISMATCH',
        message: 'The model role does not match this operation.',
        retryable: false,
      },
    };
  }
  const result = resolveModel(developmentProfiles, selection, required);

  return result.ok
    ? { success: true, data: result.profile }
    : {
        success: false,
        error: { code: result.code, message: result.message, retryable: false },
      };
}

/**
 * labels deterministic outputs and preserves requested versions
 * @param profile registered development profile
 * @param selection requested role and profile version
 * @param promptVersion version of the applied instructions
 * @param schemaVersion version of the output contract
 * @param startedAt monotonic invocation start time
 * @returns development invocation metadata
 */
function describeInvocation(
  profile: ModelProfile,
  selection: ModelSelection,
  promptVersion: string,
  schemaVersion: string,
  startedAt: number,
): ModelInvocation {
  return {
    requestedModelId: selection.modelId,
    effectiveModelId: profile.modelId,
    provider: profile.provider,
    providerModelVersion: profile.providerModelVersion,
    adapterKind: profile.adapterKind,
    capabilities: profile.capabilities,
    role: selection.role,
    profileVersion: selection.profileVersion,
    promptVersion,
    schemaVersion,
    effectiveOptions: { deterministic: true },
    latencyMs: performance.now() - startedAt,
    usage: { inputTokens: null, outputTokens: null },
    finishReason: 'development-template',
    citationCheck: { valid: true, rejectedReferenceIds: [] },
  };
}

/**
 * derives a repeatable UUID-shaped identifier for development output
 * @param value frozen record and output identity
 * @returns stable output identifier
 */
function stableId(value: string): string {
  const digest = createHash('sha256').update(value).digest('hex');

  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
