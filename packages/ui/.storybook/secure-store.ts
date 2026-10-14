const values = new Map<string, string>();

/**
 * reads a Storybook fixture value through Expo's asynchronous interface
 * @param key fixture storage key
 * @returns stored value, or null when the key has not been set
 */
export async function getItemAsync(key: string): Promise<string | null> {
  return values.get(key) ?? null;
}

/**
 * updates an in-memory Storybook fixture value
 * @param key fixture storage key
 * @param value fixture storage value
 */
export async function setItemAsync(key: string, value: string): Promise<void> {
  values.set(key, value);
}
