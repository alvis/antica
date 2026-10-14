import { Buffer } from 'node:buffer';
import { isDeepStrictEqual } from 'node:util';
import { deserialize, serialize } from 'node:v8';

import { z } from 'zod';

export const ownerWireSchema = z.strictObject({
  format: z.literal('antica-cli-owner-v3/v8-base64'),
  data: z.base64().min(1),
});

/** JSON-safe transport of the complete selected owner observation */
export type CliCoverageOwnerWire = z.infer<typeof ownerWireSchema>;

/**
 * rejects values outside the selected plain-data transport domain
 * @param value selected owner data at the current graph node
 * @param visited objects already inspected in this graph
 */
function validateOwnerData(value: unknown, visited = new Set<object>()): void {
  if (
    value === null ||
    ['undefined', 'string', 'boolean', 'number', 'bigint'].includes(
      typeof value,
    )
  ) {
    return;
  }
  if (typeof value !== 'object') {
    throw new TypeError('Unsupported owner wire data');
  }
  if (visited.has(value)) {
    return;
  }
  const prototype = Array.isArray(value) ? Array.prototype : Object.prototype;
  if (Object.getPrototypeOf(value) !== prototype) {
    throw new TypeError('Unsupported owner wire prototype');
  }
  visited.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      !descriptor ||
      !Object.hasOwn(descriptor, 'value') ||
      (!descriptor.enumerable && !(Array.isArray(value) && key === 'length'))
    ) {
      throw new TypeError('Unsupported owner wire property');
    }
    const child: unknown = descriptor.value;
    validateOwnerData(child, visited);
  }
}

/**
 * encodes every selected value and proves the serializer preserves it
 * @param value complete selected owner or fresh plain-data observation
 * @returns a strict JSON-safe envelope
 */
export function encodeOwnerWire(value: unknown): CliCoverageOwnerWire {
  validateOwnerData(value);
  const bytes = serialize(value);
  const restored: unknown = deserialize(bytes);
  if (!isDeepStrictEqual(value, restored)) {
    throw new Error('Owner wire roundtrip changed value');
  }

  return ownerWireSchema.parse({
    format: 'antica-cli-owner-v3/v8-base64',
    data: bytes.toString('base64'),
  });
}

/**
 * decodes the versioned envelope without claiming an owner schema
 * @param value unknown JSON or injected transport
 * @returns plain data requiring owner validation at its consumer
 */
export function decodeOwnerWire(value: unknown): unknown {
  const wire = ownerWireSchema.parse(value);
  const decoded: unknown = deserialize(Buffer.from(wire.data, 'base64'));
  validateOwnerData(decoded);

  return decoded;
}
