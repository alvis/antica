import { z } from 'zod';

import { Prisma } from './generated/client.js';

/**
 * serializes a nullable JSON column with SQL NULL distinct from JSON null
 * @param value application value accepted by the existing JSON serializer
 * @returns Prisma JSON input, or the explicit database-null sentinel
 */
export function nullableJson(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === null || value === undefined) {
    return Prisma.DbNull;
  }
  const json = z.json().parse(JSON.parse(JSON.stringify(value)));

  return json === null ? Prisma.DbNull : json;
}

/**
 * serializes a required JSON value, including a literal JSON null
 * @param value application JSON value
 * @returns JSON input preserving the JSON-null sentinel
 */
export function jsonValue(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const json = z.json().parse(JSON.parse(JSON.stringify(value)));

  return json === null ? Prisma.JsonNull : json;
}
