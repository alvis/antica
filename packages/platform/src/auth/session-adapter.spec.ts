import { describe, expect, it, vi } from 'vitest';

import { createDatabase } from '../database/connection.js';

import { createSessionAdapter } from './session-adapter.js';

const instant = new Date('2026-10-19T00:00:00.000Z');
const session = {
  id: 'session',
  token: 'token',
  userId: 'user',
  createdAt: instant,
  updatedAt: instant,
  expiresAt: instant,
  ipAddress: null,
  userAgent: null,
};
const user = {
  id: 'user',
  name: 'Collector',
  email: 'collector@example.invalid',
  emailVerified: false,
  image: null,
  phoneNumber: '+447700900123',
  phoneNumberVerified: true,
  createdAt: instant,
  updatedAt: instant,
};

describe('fn:createSessionAdapter', () => {
  it('should hydrate joined user dates and return no session when the token is absent', async () => {
    const connection = createDatabase({
      url: 'postgresql://unused:unused@127.0.0.1:1/unused',
    });
    const adapter = createSessionAdapter(connection.db)({});
    vi.spyOn(connection.db, '$queryRaw')
      .mockResolvedValueOnce([
        {
          ...session,
          user: {
            ...user,
            createdAt: instant.toISOString(),
            updatedAt: instant.toISOString(),
          },
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          ...session,
          user: {
            ...user,
            createdAt: instant.toISOString(),
            updatedAt: instant.toISOString(),
          },
        },
      ]);
    const input = {
      model: 'session',
      where: [{ field: 'token', value: 'token' }],
      join: { user: true },
    };
    try {
      expect(await adapter.findOne(input)).toEqual({ ...session, user });
      expect(await adapter.findOne(input)).toBeNull();
      expect(
        await adapter.findOne({
          ...input,
          where: [
            {
              field: 'token',
              value: 'token',
              operator: 'eq',
              mode: 'sensitive',
            },
          ],
        }),
      ).toEqual({ ...session, user });
    } finally {
      await connection.close();
    }
  });

  it('should delegate noncanonical lookup predicates and projections to the standard adapter', async () => {
    const connection = createDatabase({
      url: 'postgresql://unused:unused@127.0.0.1:1/unused',
    });
    const adapter = createSessionAdapter(connection.db)({});
    vi.spyOn(connection.db.session, 'findFirst').mockResolvedValue(session);
    vi.spyOn(connection.db.user, 'findFirst').mockResolvedValue(user);
    const base = {
      model: 'session',
      where: [{ field: 'token', value: 'token' }],
    };
    try {
      const variants: Array<Parameters<typeof adapter.findOne>[0]> = [
        {
          ...base,
          model: 'user',
          where: [{ field: 'id', value: 'user' }],
        },
        { ...base, select: ['id'] },
        { ...base, where: [] },
        {
          ...base,
          where: [{ field: 'id', value: 'session' }],
        },
        { ...base, where: [{ field: 'token', value: 17 }] },
        {
          ...base,
          where: [{ field: 'token', value: 'token', operator: 'ne' as const }],
        },
        {
          ...base,
          where: [
            { field: 'token', value: 'token', mode: 'insensitive' as const },
          ],
        },
        { ...base },
        { ...base, join: { user: false } },
      ];
      await expect(
        adapter.findOne({ ...base, join: { user: true, account: true } }),
      ).rejects.toThrow();
      for (const input of variants) {
        expect(await adapter.findOne(input)).toMatchObject({
          id: input.model === 'user' ? 'user' : 'session',
        });
      }
    } finally {
      await connection.close();
    }
  });
});
