import type { ReferenceImage, SourcePage, SourceRegion } from '@antica/domain';

import type { OperationResult } from './result.js';

export interface ParsedSourcePack {
  readonly sourceVersionId: string;
  readonly parseRunId: string;
  readonly rawOutputAssetId: string;
  readonly pages: readonly SourcePage[];
  readonly regions: readonly SourceRegion[];
  readonly images: readonly ReferenceImage[];
  readonly warnings: ReadonlyArray<{
    readonly pageId: string | null;
    readonly messageZhHant: string;
  }>;
}
export interface SourceParsingPort {
  parse(input: {
    readonly sourceVersionId: string;
    readonly parseRunId: string;
    readonly originalAssetIds: readonly string[];
    readonly pageIds?: readonly string[];
  }): Promise<OperationResult<ParsedSourcePack>>;
}

export interface SourceParsingHandle {
  readonly sourceVersionId: string;
  readonly parseRunId: string;
  readonly originalAssetId: string;
  readonly provider: string;
  readonly providerJobId: string;
}
export type SourceParsingProgress =
  | ({
      readonly kind: 'waiting';
      readonly resumeAfter?: string;
    } & SourceParsingHandle)
  | { readonly kind: 'completed'; readonly pack: ParsedSourcePack };
export interface DurableSourceParsingPort {
  submit(input: {
    readonly sourceVersionId: string;
    readonly parseRunId: string;
    readonly originalAssetId: string;
  }): Promise<OperationResult<SourceParsingProgress>>;
  resume(
    handle: SourceParsingHandle,
  ): Promise<OperationResult<SourceParsingProgress>>;
}
