import { fileURLToPath } from 'node:url';
import { createDatabase } from './connection.js';
import { ensureCollectorUser } from './collector.js';
import { locations, records } from './schema/index.js';

/** development database and collector identity for illustrative fixtures */
export interface SeedParams {
  readonly url: string;
  readonly phoneNumber: string;
}

/**
 * inserts visibly illustrative development fixtures without touching existing rows
 */
export async function seedIllustrativeData({
  url,
  phoneNumber,
}: SeedParams): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Illustrative seed is development-only');
  }
  const connection = createDatabase({ url, maxConnections: 1 });
  try {
    const ownerId = await ensureCollectorUser({
      db: connection.db,
      phoneNumber,
    });
    await connection.db.transaction(async (tx) => {
      const locationId = '00000000-0000-4000-8000-000000000101';
      await tx
        .insert(locations)
        .values({
          id: locationId,
          ownerId,
          label: 'Illustrative shelf',
          normalizedLabel: 'illustrative shelf',
        })
        .onConflictDoNothing();
      await tx
        .insert(records)
        .values({
          id: '00000000-0000-4000-8000-000000000201',
          ownerId,
          code: 'AC-ILLUSTRATIVE-001',
          name: 'Illustrative ceramic bowl',
          unitKind: 'single',
          locationId,
          description:
            'Synthetic fixture for local development; not an attributed antique.',
        })
        .onConflictDoNothing();
    });
  } finally {
    await connection.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  const phoneNumber = process.env.ANTICA_COLLECTOR_PHONE;
  if (!url || !phoneNumber) {
    throw new Error('DATABASE_URL and ANTICA_COLLECTOR_PHONE are required');
  }
  await seedIllustrativeData({ url, phoneNumber });
}
