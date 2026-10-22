import { expect, it, jest } from '@jest/globals';

import { QueryClient } from '@tanstack/react-query';

import { recordHistoryQuery } from '../features/collection/api/record-history';

import { createCookieStorage } from './cookie-storage';
import { MobileApiTransport } from './mobile-api-transport';

/**
 * creates an authentication transport using the Expo client's write-through storage
 * @param cookie initial durable session cookie
 * @returns the storage and transport harness
 */
function runtime(cookie = 'session=first') {
  let persisted = cookie;
  let version = 0;
  const device = {
    getItem: jest.fn(() => persisted),
    getItemAsync: jest.fn(async () => persisted),
    setItem: jest.fn((_key: string, value: string) => {
      persisted = value;
    }),
    setItemAsync: jest.fn(async (_key: string, value: string) => {
      persisted = value;
    }),
    deleteItemAsync: jest.fn(async () => {
      persisted = '';
    }),
  };
  const storage = createCookieStorage(device, 'antica_cookie');
  const expire = jest.fn(() => storage.clear());
  const api = new MobileApiTransport({
    baseUrl: 'http://localhost:8103',
    session: {
      getCookie: async () =>
        (await storage.getItemAsync('antica_cookie')) ?? '',
      onUnauthorized: expire,
    },
    refreshCookie: storage.clear,
    getSessionVersion: () => version,
  });

  return {
    storage,
    device,
    api,
    expire,
    switchOwner: () => {
      version += 1;
    },
    rotateExternally: () => {
      persisted = 'session=external';
    },
  };
}

const schema = { parse: (value: unknown): unknown => value };

it('should reject an anonymous request without retrying or expiring a session', async () => {
  const { api, expire, device } = runtime('');
  const request = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response('{}', { status: 401 }));

  await expect(api.get('/history', schema)).rejects.toMatchObject({
    status: 401,
  });

  expect(request).toHaveBeenCalledTimes(1);
  expect(expire).not.toHaveBeenCalled();
  expect(device.getItemAsync).toHaveBeenCalledTimes(1);
});

it('should keep a concurrent signed-in request from changing an anonymous request’s recovery', async () => {
  const { api, storage, expire } = runtime('');
  const anonymous = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<void>();
  const request = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementationOnce(async () => {
      started.resolve();

      return anonymous.promise;
    })
    .mockImplementation(async () => new Response('{}'));
  const pending = api.get('/anonymous', schema);
  await started.promise;
  await storage.setItemAsync('antica_cookie', 'session=new-owner');
  await api.get('/signed-in', schema);

  anonymous.resolve(new Response('{}', { status: 401 }));
  await expect(pending).rejects.toMatchObject({ status: 401 });

  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1]?.[1]?.headers).toMatchObject({
    Cookie: 'session=new-owner',
  });
  expect(expire).not.toHaveBeenCalled();
});

it('should start a warm history fetch without another native storage read', async () => {
  const { storage, device, api } = runtime();
  await storage.getItemAsync('antica_cookie');
  device.getItemAsync.mockImplementation(
    async () => new Promise(() => undefined),
  );
  const request = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      new Response(JSON.stringify({ items: [], nextCursor: null })),
    );
  const client = new QueryClient();
  try {
    await expect(
      client.fetchInfiniteQuery(recordHistoryQuery(api, 'record-1')),
    ).resolves.toMatchObject({ pages: [{ items: [] }] });
    expect(request).toHaveBeenCalledWith(
      'http://localhost:8103/v1/records/record-1/history?limit=20',
      expect.any(Object),
    );
    expect(device.getItemAsync).toHaveBeenCalledTimes(1);
  } finally {
    client.clear();
  }
});

it('should use a response rotation on the next request', async () => {
  const { storage, api } = runtime();
  const request = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => {
      await storage.setItemAsync('antica_cookie', 'session=rotated');

      return new Response('{}');
    });
  await api.get('/first', schema);
  await api.get('/next', schema);
  expect(request.mock.calls[1]?.[1]?.headers).toMatchObject({
    Cookie: 'session=rotated',
  });
});

it('should reread storage and retry a rejected cookie once before expiring', async () => {
  const { api, device, expire, rotateExternally } = runtime();
  const request = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementationOnce(async () => {
      rotateExternally();

      return new Response('{}', { status: 401 });
    })
    .mockResolvedValueOnce(new Response('{}'));
  await api.get('/history', schema);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1]?.[1]?.headers).toMatchObject({
    Cookie: 'session=external',
  });
  expect(device.getItemAsync).toHaveBeenCalledTimes(2);
  expect(expire).not.toHaveBeenCalled();
});

it('should expire after the second rejection and preserve command identity on retry', async () => {
  const { api, expire } = runtime();
  const request = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response('{}', { status: 401 }));
  await expect(
    api.post('/changes', schema, {
      body: { selected: ['one'] },
      idempotencyKey: 'command-1',
    }),
  ).rejects.toMatchObject({ status: 401 });
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[0]?.[1]).toEqual(request.mock.calls[1]?.[1]);
  expect(expire).toHaveBeenCalledTimes(1);
});

it('should preserve non-session errors without retrying or expiring', async () => {
  const { api, expire } = runtime();
  const request = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response('{}', { status: 409 }));
  await expect(
    api.patch('/record', schema, { body: {} }),
  ).rejects.toMatchObject({ status: 409 });
  expect(request).toHaveBeenCalledTimes(1);
  expect(expire).not.toHaveBeenCalled();
});

it('should neither retry nor expire a new owner after the old owner’s delayed rejection', async () => {
  const { api, expire, switchOwner } = runtime();
  let finish = (_response: Response): void => undefined;
  let started = (): void => undefined;
  const requestStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const request = jest.spyOn(globalThis, 'fetch').mockImplementationOnce(
    async () =>
      new Promise((resolve) => {
        finish = resolve;
        started();
      }),
  );
  const pending = api.get('/history', schema);
  await requestStarted;
  switchOwner();
  finish(new Response('{}', { status: 401 }));
  await expect(pending).rejects.toMatchObject({ status: 401 });
  expect(request).toHaveBeenCalledTimes(1);
  expect(expire).not.toHaveBeenCalled();
});

it('should not expire the new owner when an old owner’s retry finishes late', async () => {
  const { api, expire, switchOwner } = runtime();
  let finish = (_response: Response): void => undefined;
  let started = (): void => undefined;
  const retryStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const request = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response('{}', { status: 401 }))
    .mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          finish = resolve;
          started();
        }),
    );
  const pending = api.get('/history', schema);
  await retryStarted;
  switchOwner();
  finish(new Response('{}', { status: 401 }));
  await expect(pending).rejects.toMatchObject({ status: 401 });
  expect(request).toHaveBeenCalledTimes(2);
  expect(expire).not.toHaveBeenCalled();
});
