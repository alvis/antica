import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { locationSchema, locationsSchema } from '@antica/contracts';

import { createHttpFixture } from '../fixtures/http.js';

let fixture: Awaited<ReturnType<typeof createHttpFixture>>;
beforeAll(async () => {
  fixture = await createHttpFixture();
}, 30_000);
afterAll(async () => {
  await fixture.close();
});

describe('Location HTTP transport', () => {
  it('should create a collector location and return the list consumed by capture', async () => {
    const response = await fixture.request('/v1/locations', 'POST', {
      label: 'Study cabinet / 書房櫃',
    });
    expect(response.status).toBe(201);
    const location = locationSchema.parse(await response.json());
    expect(location).toEqual({
      id: expect.any(String),
      label: 'Study cabinet / 書房櫃',
    });
    const listed = await fixture.request('/v1/locations');
    expect(listed.status).toBe(200);
    expect(await listed.json()).toContainEqual(location);
  });

  it('should hide another owner location from the authenticated collector list', async () => {
    const foreign = { id: randomUUID(), label: 'Foreign private cabinet' };
    await fixture.runtime.transaction.run(randomUUID(), async (unit) => {
      await unit.locations.create(foreign);

      return { success: true, data: undefined };
    });
    const response = await fixture.request('/v1/locations');
    expect(response.status).toBe(200);
    expect(await response.json()).not.toContainEqual(foreign);
  });

  it('should reuse the same owner location for a retry with equivalent label casing and whitespace', async () => {
    const first = await fixture.request('/v1/locations', 'POST', {
      label: '  Display cabinet  ',
    });
    expect(first.status).toBe(201);
    const location = locationSchema.parse(await first.json());
    expect(location.label).toBe('Display cabinet');
    const repeated = await fixture.request('/v1/locations', 'POST', {
      label: 'display CABINET',
    });
    expect(repeated.status).toBe(201);
    expect(await repeated.json()).toEqual(location);
    const listed = locationsSchema.parse(
      await (await fixture.request('/v1/locations')).json(),
    );
    expect(
      listed.filter((item) => item.label.toLowerCase() === 'display cabinet'),
    ).toEqual([location]);
  });

  it('should converge simultaneous equivalent location requests on one persisted identity', async () => {
    const labels = [
      'Concurrent cabinet',
      ' concurrent CABINET ',
      'CONCURRENT CABINET',
      'Concurrent cabinet',
    ];
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const barrier = fixture.runtime.database.db.transaction(
      async (transaction) => {
        await transaction.execute('LOCK TABLE locations IN SHARE MODE');
        locked.resolve();
        await release.promise;
      },
    );
    await locked.promise;
    const requests = Promise.all(
      labels.map(async (label) =>
        fixture.request('/v1/locations', 'POST', { label }),
      ),
    );
    try {
      await expect
        .poll(
          async () => {
            const rows = await fixture.runtime.database.db.execute(
              "SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
            );

            return rows[0]?.count;
          },
          { timeout: 5000 },
        )
        .toBe(4);
    } finally {
      release.resolve();
      await barrier;
    }
    const responses = await requests;
    expect(responses.map((response) => response.status)).toEqual([
      201, 201, 201, 201,
    ]);
    const locations = await Promise.all(
      responses.map(async (response) =>
        locationSchema.parse(await response.json()),
      ),
    );
    expect(new Set(locations.map((location) => location.id)).size).toBe(1);
    const listed = locationsSchema.parse(
      await (await fixture.request('/v1/locations')).json(),
    );
    expect(
      listed.filter(
        (location) => location.label.toLowerCase() === 'concurrent cabinet',
      ),
    ).toEqual([locations[0]]);
  });

  it.each(['GET', 'POST'])(
    'should require authentication for %s locations',
    async (method) => {
      const response = await fixture.runtime.app.request('/v1/locations', {
        method,
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: 'AUTH_REQUIRED' });
    },
  );

  it.each([{}, { label: '' }, { label: '   ' }, { label: 1 }])(
    'should reject invalid location input %j without persisting it',
    async (input) => {
      const before = await fixture.request('/v1/locations');
      const response = await fixture.request('/v1/locations', 'POST', input);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      expect(await (await fixture.request('/v1/locations')).json()).toEqual(
        await before.json(),
      );
    },
  );
});
