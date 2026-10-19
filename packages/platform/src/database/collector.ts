import type { Database } from './connection.js';

export const collectorUserId = 'antica-collector';

/** configured collector identity and database connection */
export interface CollectorParams {
  readonly db: Database;
  readonly phoneNumber: string;
}

/**
 * ensures the one configured collector account exists before authentication
 * @param params database and configured collector phone
 * @param params.db
 * @param params.phoneNumber
 * @returns the stable collector identity
 */
export async function ensureCollectorUser({
  db,
  phoneNumber,
}: CollectorParams): Promise<string> {
  await db.user.createMany({
    data: {
      id: collectorUserId,
      name: 'Collector',
      email: 'collector@antica.invalid',
      phoneNumber,
      phoneNumberVerified: true,
    },
    skipDuplicates: true,
  });
  const collector = await db.user.findUnique({
    where: { id: collectorUserId },
    select: { phoneNumber: true },
  });
  if (collector?.phoneNumber !== phoneNumber) {
    throw new Error(
      'Configured collector phone does not match persisted account',
    );
  }

  return collectorUserId;
}
