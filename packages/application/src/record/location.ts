import type { Location, LocationCreate } from '@antica/contracts';

import type {
  IdPort,
  OperationResult,
  TransactionPort,
} from '../ports/index.js';

/** supplies owner-scoped location options for collection capture */
export interface LocationService {
  create(
    ownerId: string,
    input: LocationCreate,
  ): Promise<OperationResult<Location>>;
  list(ownerId: string): Promise<OperationResult<readonly Location[]>>;
}

/**
 * creates owner-scoped location operations
 * @param transaction persistent transaction boundary
 * @param ids stable identity source
 * @returns location operations for authenticated API routes
 */
export function createLocationService(
  transaction: TransactionPort,
  ids: IdPort,
): LocationService {
  return {
    create: async (ownerId, input) =>
      transaction.run(ownerId, async (unit) => {
        const existing = await unit.locations.findByLabel(input.label);
        if (existing) {
          return { success: true, data: existing };
        }
        const location = { id: ids.create(), label: input.label };

        return { success: true, data: await unit.locations.create(location) };
      }),
    list: async (ownerId) =>
      transaction.run(ownerId, async (unit) => ({
        success: true,
        data: await unit.locations.query(),
      })),
  };
}
