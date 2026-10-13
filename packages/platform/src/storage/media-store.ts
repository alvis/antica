/** immutable private media object expected at upload completion */
export interface OriginalObject {
  readonly assetId: string;
  readonly key: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly sha256: string;
}

/** short-lived transfer authorization returned to a collector */
export interface SignedTransfer {
  readonly url: string;
  readonly expiresAt: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface MultipartTransfer {
  readonly uploadId: string;
  readonly expiresAt: string;
  readonly parts: readonly {
    readonly partNumber: number;
    readonly offset: number;
    readonly byteLength: number;
    readonly putUrl: string;
    readonly headers: Readonly<Record<string, string>>;
  }[];
}

/** private object storage, with immutable originals and traceable derivatives */
export interface MediaStore {
  signUpload(input: OriginalObject): Promise<SignedTransfer>;
  startMultipart?(input: OriginalObject): Promise<MultipartTransfer>;
  completeMultipart?(
    input: OriginalObject,
    uploadId: string,
    parts: readonly { readonly partNumber: number; readonly etag: string }[],
  ): Promise<void>;
  abortMultipart?(input: OriginalObject, uploadId: string): Promise<void>;
  verifyOriginal(input: OriginalObject): Promise<void>;
  signRead(key: string): Promise<SignedTransfer>;
  read(
    key: string,
  ): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }>;
  writeDerivative(input: {
    readonly key: string;
    readonly bytes: Uint8Array;
    readonly mimeType: string;
  }): Promise<void>;
  writeArtifact(input: {
    readonly key: string;
    readonly bytes: Uint8Array;
    readonly mimeType: string;
  }): Promise<void>;
}

/** assigns an unpredictable, immutable key for an original asset */
export function originalKey(assetId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) {
    throw new Error('Invalid asset ID');
  }
  return `originals/${assetId.toLowerCase()}`;
}

/** assigns a key that retains the derivative's original-asset provenance */
export function derivativeKey(
  originalAssetId: string,
  derivativeId: string,
): string {
  if (
    !/^[0-9a-f-]{36}$/i.test(originalAssetId) ||
    !/^[0-9a-f-]{36}$/i.test(derivativeId)
  ) {
    throw new Error('Invalid derivative IDs');
  }
  return `derivatives/${originalAssetId.toLowerCase()}/${derivativeId.toLowerCase()}`;
}

/** binds generated parser output to its immutable source and parse attempt */
export function artifactKey(
  sourceVersionId: string,
  parseRunId: string,
  assetId: string,
): string {
  if (
    ![sourceVersionId, parseRunId, assetId].every((id) =>
      /^[0-9a-f-]{36}$/i.test(id),
    )
  ) {
    throw new Error('Invalid artifact IDs');
  }
  return `artifacts/${sourceVersionId.toLowerCase()}/${parseRunId.toLowerCase()}/${assetId.toLowerCase()}`;
}

export function assertStorageKey(key: string): void {
  if (
    !/^(originals|derivatives|artifacts)\/[a-z0-9/-]+$/.test(key) ||
    key.includes('..')
  ) {
    throw new Error('Invalid storage key');
  }
}
