import { expect, it, jest } from '@jest/globals';

import { createCookieStorage } from './cookie-storage';

/** encrypted-storage substitute whose reads can be held to expose hydration races */
function deviceStorage() {
  const values = new Map<string, string>();

  return {
    values,
    getItem: jest.fn((key: string) => values.get(key) ?? null),
    getItemAsync: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      values.delete(key);
    }),
  };
}

it('should share parallel first reads and serve warm reads without native storage', async () => {
  const device = deviceStorage();
  let finish: (value: string) => void = (_value: string) => undefined;
  device.getItemAsync.mockImplementationOnce(
    async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const storage = createCookieStorage(device, 'antica_cookie');
  const reads = Array.from({ length: 8 }, async () =>
    storage.getItemAsync('antica_cookie'),
  );
  expect(device.getItemAsync).toHaveBeenCalledTimes(1);
  finish('session=first');
  expect(await Promise.all(reads)).toEqual(Array(8).fill('session=first'));
  expect(await storage.getItemAsync('antica_cookie')).toBe('session=first');
  expect(storage.getItem('antica_cookie')).toBe('session=first');
  expect(device.getItemAsync).toHaveBeenCalledTimes(1);
  expect(device.getItem).not.toHaveBeenCalled();
});

it('should observe sync and async rotations and deletion at the storage source', async () => {
  const device = deviceStorage();
  const storage = createCookieStorage(device, 'antica_cookie');
  await storage.setItemAsync('antica_cookie', 'session=first');
  storage.setItem('antica_cookie', 'session=rotated');
  expect(await storage.getItemAsync('antica_cookie')).toBe('session=rotated');
  await storage.setItemAsync('antica_cookie', 'session=next');
  expect(await storage.getItemAsync('antica_cookie')).toBe('session=next');
  await storage.deleteItemAsync('antica_cookie');
  expect(await storage.getItemAsync('antica_cookie')).toBeNull();
});

it('should invalidate chunk values and ignore a hydration completed after the cache was cleared', async () => {
  const device = deviceStorage();
  const storage = createCookieStorage(device, 'antica_cookie');
  let finish: (value: string) => void = (_value: string) => undefined;
  device.getItemAsync.mockImplementationOnce(
    async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const old = storage.getItemAsync('antica_cookie');
  storage.clear();
  await storage.setItemAsync('antica_cookie', 'session=new-owner');
  finish('session=old-owner');
  await old;
  expect(await storage.getItemAsync('antica_cookie')).toBe('session=new-owner');
  await storage.setItemAsync('antica_cookie.a.0', 'chunk');
  expect(await storage.getItemAsync('antica_cookie.a.0')).toBe('chunk');
  storage.clear();
  await storage.getItemAsync('antica_cookie.a.0');
  expect(device.getItemAsync).toHaveBeenLastCalledWith(
    'antica_cookie.a.0',
    undefined,
  );
});

it('should retain uncached behavior for unrelated storage and recover from failed hydration', async () => {
  const device = deviceStorage();
  const storage = createCookieStorage(device, 'antica_cookie');
  device.getItemAsync.mockRejectedValueOnce(new Error('Locked'));
  await expect(storage.getItemAsync('antica_cookie')).rejects.toThrow('Locked');
  expect(await storage.getItemAsync('antica_cookie')).toBeNull();
  await storage.setItemAsync('preferences', 'one');
  device.values.set('preferences', 'two');
  expect(await storage.getItemAsync('preferences')).toBe('two');
  expect(storage.getItem('preferences')).toBe('two');
});

it.each(['sync', 'async'] as const)(
  'should preserve warm cookie and chunk keys during a %s write to another key',
  async (mode) => {
    const device = deviceStorage();
    device.values.set('antica_cookie', 'session=first');
    device.values.set('antica_cookie.0.0', 'first-chunk');
    const storage = createCookieStorage(device, 'antica_cookie');
    await storage.getItemAsync('antica_cookie');
    await storage.getItemAsync('antica_cookie.0.0');

    if (mode === 'sync') {
      storage.setItem('antica_cookie.0.1', 'next-chunk');
    } else {
      await storage.setItemAsync('antica_cookie.0.1', 'next-chunk');
    }

    expect(await storage.getItemAsync('antica_cookie')).toBe('session=first');
    expect(await storage.getItemAsync('antica_cookie.0.0')).toBe('first-chunk');
    expect(await storage.getItemAsync('antica_cookie.0.1')).toBe('next-chunk');
    expect(device.getItemAsync.mock.calls.map(([key]) => key)).toEqual([
      'antica_cookie',
      'antica_cookie.0.0',
    ]);
  },
);

it('should retain single-flight hydration and cache its result when another key is written', async () => {
  const device = deviceStorage();
  const pending = Promise.withResolvers<string>();
  device.getItemAsync.mockImplementationOnce(async () => pending.promise);
  const storage = createCookieStorage(device, 'antica_cookie');
  const first = storage.getItemAsync('antica_cookie');

  await storage.setItemAsync('antica_cookie.1.0', 'chunk');
  const second = storage.getItemAsync('antica_cookie');
  pending.resolve('session=hydrated');

  expect(await Promise.all([first, second])).toEqual([
    'session=hydrated',
    'session=hydrated',
  ]);
  expect(await storage.getItemAsync('antica_cookie')).toBe('session=hydrated');
  expect(device.getItemAsync).toHaveBeenCalledTimes(1);
});
