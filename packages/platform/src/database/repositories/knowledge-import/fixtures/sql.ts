import { ok } from 'node:assert/strict';

import { PrismaPg } from '@prisma/adapter-pg';

/**
 * records SQL at the pg client boundary including transaction control statements
 * @param url isolated database descriptor
 * @param statements append-only statement receipts without parameter values
 * @returns real Prisma adapter with a transparent driver observer
 */
export function createMeasuredAdapter(
  url: string,
  statements: string[],
): PrismaPg {
  const adapter = new PrismaPg({ connectionString: url, max: 1 });
  const connect = adapter.connect.bind(adapter);
  adapter.connect = async () => {
    const driver = await connect();
    driver.underlyingDriver().on('connect', (client) => {
      client.query = new Proxy(client.query.bind(client), {
        /**
         * records the statement before delegating to the real pg client
         * @param target original bound query method
         * @param receiver invocation receiver
         * @param args original overloaded query arguments
         * @returns unchanged driver query result
         */
        apply(target, receiver: unknown, args: unknown[]) {
          const input = args[0];
          ok(
            input &&
              typeof input === 'object' &&
              'text' in input &&
              typeof input.text === 'string',
            'Unrecognized Prisma pg query shape prevents complete SQL accounting',
          );
          statements.push(input.text);

          return Reflect.apply(target, receiver, args);
        },
      });
    });

    return driver;
  };

  return adapter;
}
