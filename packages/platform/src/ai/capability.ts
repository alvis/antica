import type { ModelCapabilities, ModelSelection } from '@antica/contracts';

/** describes one explicitly registered model and its supported roles */
export interface ModelProfile {
  readonly modelId: string;
  readonly provider: string;
  readonly providerModelVersion: string | null;
  readonly adapterKind: 'development' | 'live';
  readonly roles: ReadonlyArray<ModelSelection['role']>;
  readonly capabilities: ModelCapabilities;
}

/** represents capability selection before a provider can be called */
export type ModelResolution =
  | { readonly ok: true; readonly profile: ModelProfile }
  | {
      readonly ok: false;
      readonly code: 'MODEL_UNKNOWN' | 'MODEL_CAPABILITY_MISMATCH';
      readonly message: string;
    };

/**
 * resolves only registered models with the required role and capabilities
 * @param profiles explicit server catalog
 * @param selection requested model and role
 * @param required input and output requirements
 * @returns a compatible profile or explicit rejection
 */
export function resolveModel(
  profiles: readonly ModelProfile[],
  selection: ModelSelection,
  required: Partial<ModelCapabilities>,
): ModelResolution {
  const profile = profiles.find(
    (candidate) => candidate.modelId === selection.modelId,
  );
  if (!profile) {
    return {
      ok: false,
      code: 'MODEL_UNKNOWN',
      message: 'The requested model is not registered.',
    };
  }
  const missing = (
    [
      'textInput',
      'imageInput',
      'audioInput',
      'structuredOutput',
      'toolCalling',
    ] as const
  ).filter(
    (capability) =>
      required[capability] === true && !profile.capabilities[capability],
  );
  const exceedsImages =
    required.maxImages !== undefined &&
    profile.capabilities.maxImages !== undefined &&
    required.maxImages > profile.capabilities.maxImages;
  const exceedsContext =
    required.maxContextTokens !== undefined &&
    profile.capabilities.maxContextTokens !== undefined &&
    required.maxContextTokens > profile.capabilities.maxContextTokens;
  if (
    !profile.roles.includes(selection.role) ||
    missing.length > 0 ||
    exceedsImages ||
    exceedsContext
  ) {
    return {
      ok: false,
      code: 'MODEL_CAPABILITY_MISMATCH',
      message:
        'The requested model does not support this role, input, or output contract.',
    };
  }

  return { ok: true, profile };
}
