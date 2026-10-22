import type * as SecureStore from 'expo-secure-store';

/** SecureStore operations used by the authentication client */
type Storage = Pick<
  typeof SecureStore,
  'getItem' | 'getItemAsync' | 'setItem' | 'setItemAsync' | 'deleteItemAsync'
>;

/** write-through, memory-only cache of the Expo client's cookie and its chunks */
export type CookieStorage = Storage & {
  clear: () => void;
  /** deletes the durable cookie and its legacy and slotted chunks on sign-out */
  remove: () => Promise<void>;
};

/**
 * keeps cookie reads off the native storage queue while observing every cookie write
 * @param storage encrypted device storage, still authoritative across app launches
 * @param key normalized Better Auth cookie key, including its optional chunk suffixes
 * @returns storage adapter with shared first reads and explicit session invalidation
 */
export function createCookieStorage(
  storage: Storage,
  key: string,
): CookieStorage {
  const values = new Map<string, string | null>();
  const reads = new Map<string, Promise<string | null>>();
  const generations = new Map<string, number>();
  let generation = 0;
  const isCookie = (name: string): boolean =>
    name === key || name.startsWith(`${key}.`);
  const clear = (): void => {
    generation += 1;
    values.clear();
    reads.clear();
    generations.clear();
  };
  const invalidate = (name: string): void => {
    generations.set(name, (generations.get(name) ?? 0) + 1);
    values.delete(name);
    reads.delete(name);
  };

  return {
    clear,
    remove: async () => {
      clear();
      await storage.deleteItemAsync(key);
      for (const prefix of [key, `${key}.0`, `${key}.1`]) {
        for (let index = 0; ; index += 1) {
          const name = `${prefix}.${index}`;
          if ((await storage.getItemAsync(name)) === null) {
            break;
          }
          await storage.deleteItemAsync(name);
        }
      }
    },
    getItem: (name, options) => {
      if (!isCookie(name)) {
        return storage.getItem(name, options);
      }
      if (values.has(name)) {
        return values.get(name) ?? null;
      }
      const value = storage.getItem(name, options);
      values.set(name, value);

      return value;
    },
    getItemAsync: async (name, options) => {
      if (!isCookie(name)) {
        return storage.getItemAsync(name, options);
      }
      if (values.has(name)) {
        return Promise.resolve(values.get(name) ?? null);
      }
      const existing = reads.get(name);
      if (existing) {
        return existing;
      }
      const started = generation;
      const keyGeneration = generations.get(name) ?? 0;
      const read = storage
        .getItemAsync(name, options)
        .then((value) => {
          if (
            generation === started &&
            (generations.get(name) ?? 0) === keyGeneration
          ) {
            values.set(name, value);
          }

          return value;
        })
        .finally(() => {
          if (reads.get(name) === read) {
            reads.delete(name);
          }
        });
      reads.set(name, read);

      return read;
    },
    setItem: (name, value, options) => {
      if (isCookie(name)) {
        invalidate(name);
      }
      storage.setItem(name, value, options);
      if (isCookie(name)) {
        values.set(name, value);
      }
    },
    setItemAsync: async (name, value, options) => {
      if (isCookie(name)) {
        invalidate(name);
      }
      const started = generation;
      const keyGeneration = generations.get(name) ?? 0;
      await storage.setItemAsync(name, value, options);
      if (
        isCookie(name) &&
        generation === started &&
        (generations.get(name) ?? 0) === keyGeneration
      ) {
        values.set(name, value);
      }
    },
    deleteItemAsync: async (name, options) => {
      if (isCookie(name)) {
        invalidate(name);
      }
      await storage.deleteItemAsync(name, options);
    },
  };
}
