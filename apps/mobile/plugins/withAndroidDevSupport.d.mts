import type { ConfigPlugin } from 'expo/config-plugins';

/** Patch the generated Expo 57 Kotlin host, preserving an already patched host. */
export declare function addAndroidDevSupport(source: string): string;

/** Apply the Kotlin host patch during Expo Android prebuild. */
export declare const withAndroidDevSupport: ConfigPlugin;
