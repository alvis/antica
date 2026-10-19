import { prismaAdapter } from 'better-auth/adapters/prisma';

import type { Database } from '../database/connection.js';
import type { user } from '../database/generated/client.js';

/** Database JSON timestamps need hydration to match Prisma's native user result. */
type JoinedUser = Omit<user, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};
type SessionAdapterFactory = ReturnType<typeof prismaAdapter>;

/**
 * Combines Better Auth's exact session-token lookup with its required user lookup.
 * All session validation, expiry, revocation and refresh remain in Better Auth.
 * Other adapter requests retain the standard Prisma implementation.
 * @param db database with the application's fixed Better Auth table mappings
 * @returns adapter factory with one parameterized session/user read
 */
export function createSessionAdapter(db: Database): SessionAdapterFactory {
  const factory = prismaAdapter(db, { provider: 'postgresql' });

  return (options) => {
    const adapter = factory(options);

    return {
      ...adapter,
      findOne: async <T>(
        input: Parameters<typeof adapter.findOne>[0],
      ): Promise<T | null> => {
        const [predicate] = input.where;
        if (
          input.model !== 'session' ||
          input.select !== undefined ||
          input.where.length !== 1 ||
          predicate?.field !== 'token' ||
          typeof predicate.value !== 'string' ||
          (predicate.operator !== undefined && predicate.operator !== 'eq') ||
          (predicate.mode !== undefined && predicate.mode !== 'sensitive') ||
          input.join?.user !== true ||
          Object.keys(input.join).length !== 1
        ) {
          return adapter.findOne<T>(input);
        }
        const rows = await db.$queryRaw<Array<T & { user: JoinedUser }>>`
          SELECT s.id, s.expires_at AS "expiresAt", s.token,
            s.created_at AS "createdAt", s.updated_at AS "updatedAt",
            s.ip_address AS "ipAddress", s.user_agent AS "userAgent", s.user_id AS "userId",
            jsonb_build_object(
              'id', u.id, 'name', u.name, 'email', u.email,
              'emailVerified', u.email_verified, 'image', u.image,
              'phoneNumber', u.phone_number, 'phoneNumberVerified', u.phone_number_verified,
              'createdAt', u.created_at, 'updatedAt', u.updated_at
            ) AS "user"
          FROM session s JOIN "user" u ON u.id = s.user_id
          WHERE s.token = ${predicate.value}
          LIMIT 1
        `;
        const row = rows[0];

        return row
          ? {
              ...row,
              user: {
                ...row.user,
                createdAt: new Date(row.user.createdAt),
                updatedAt: new Date(row.user.updatedAt),
              },
            }
          : null;
      },
    };
  };
}
