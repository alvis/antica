import { eq } from 'drizzle-orm';
import type { Database } from './connection.js';
import { user } from './schema/auth.js';

export const collectorUserId = 'antica-collector';

/** configured collector identity and database connection */
export interface CollectorParams {
  readonly db: Database;
  readonly phoneNumber: string;
}

/**
 * ensures the one configured collector account exists before authentication
 */
export async function ensureCollectorUser({
  db,
  phoneNumber,
}: CollectorParams): Promise<string> {
  await db
    .insert(user)
    .values({
      id: collectorUserId,
      name: 'Collector',
      email: 'collector@antica.invalid',
      phoneNumber,
      phoneNumberVerified: true,
    })
    .onConflictDoNothing();
  const [collector] = await db
    .select({ phoneNumber: user.phoneNumber })
    .from(user)
    .where(eq(user.id, collectorUserId));
  if (collector?.phoneNumber !== phoneNumber) {
    throw new Error(
      'Configured collector phone does not match persisted account',
    );
  }
  return collectorUserId;
}
