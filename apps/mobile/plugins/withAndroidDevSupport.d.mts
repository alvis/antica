import type { ConfigPlugin } from 'expo/config-plugins';

/**
 * patches the generated Expo 57 Kotlin host, preserving an already patched host
 * @param source generated Kotlin MainApplication source
 * @returns source with explicit app debug support
 */
export declare function addAndroidDevSupport(source: string): string;

/** applies the Kotlin host patch during Expo Android prebuild */
export declare const withAndroidDevSupport: ConfigPlugin;
