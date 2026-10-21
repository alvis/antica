/** what Metro passes a custom resolver, as far as the workspace resolver reads it */
export interface ResolutionContext {
  readonly originModulePath: string;
  readonly resolveRequest: CustomResolver;
}

/** a module Metro resolved */
export type Resolution =
  | { readonly type: 'sourceFile'; readonly filePath: string }
  | { readonly type: 'empty' }
  | { readonly type: 'assetFiles'; readonly filePaths: readonly string[] };

/** Metro's custom resolver */
export type CustomResolver = (
  context: ResolutionContext,
  moduleName: string,
  platform: string | null,
) => Resolution;

/**
 * builds Metro's resolveRequest for the workspace
 * @param workspaceRoot absolute path of the repository root
 * @returns the resolver
 */
export function createResolveRequest(workspaceRoot: string): CustomResolver;
