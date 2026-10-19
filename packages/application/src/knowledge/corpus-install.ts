import type {
  CorpusEntry,
  CorpusRelease,
  CorpusSource,
  CorpusTaxonomy,
} from '@antica/contracts';

/** validated offline release and the explicit collector installation request */
export interface CorpusInstallRequest {
  readonly ownerId: string;
  readonly requestKey: string;
  readonly release: CorpusRelease;
  readonly sources: readonly CorpusSource[];
  readonly entries: readonly CorpusEntry[];
  readonly topics: CorpusTaxonomy['topics'];
  readonly dryRun?: boolean;
}
/** installation outcome for one stable content identity */
export interface CorpusInstallDisposition {
  readonly contentId: string;
  readonly disposition: 'created' | 'unchanged' | 'update_draft' | 'conflict';
}
/** persisted receipt progress and the bounded write plan */
export interface CorpusInstallPlan {
  readonly installId: string;
  readonly completed: boolean;
  readonly checkpoint: number;
  readonly batchCount: number;
  readonly predictedStatements: number;
  readonly items: readonly CorpusInstallDisposition[];
}
/** owner-scoped atomic persistence shared by CLI and future application callers */
export interface CorpusInstallRepository {
  inspect(request: CorpusInstallRequest): Promise<CorpusInstallPlan>;
  applyBatch(index: number): Promise<void>;
}
/**
 * resumes atomic installation batches without ever issuing a collector save
 * @param request validated corpus and explicit owner/request identities
 * @param repository persistence capabilities scoped to this installation
 * @returns receipt and planned dispositions, including read-only dry runs
 */
export async function installCorpusRelease(
  request: CorpusInstallRequest,
  repository: CorpusInstallRepository,
): Promise<CorpusInstallPlan> {
  const plan = await repository.inspect(request);
  if (!request.dryRun && !plan.completed) {
    for (let index = plan.checkpoint; index < plan.batchCount; index += 1) {
      await repository.applyBatch(index);
    }
  }

  return request.dryRun || plan.completed ? plan : repository.inspect(request);
}
