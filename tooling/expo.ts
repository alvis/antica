/** supplies the Expo-owned TypeScript configuration for the native application */
export const expoTypeScriptConfig = {
  extends: 'expo/tsconfig.base',
  compilerOptions: {
    strict: true,
  },
  include: [
    'src/**/*.ts',
    'src/**/*.tsx',
    'app.config.ts',
    'presetter.config.ts',
    'expo-env.d.ts',
    '.expo/types/**/*.ts',
  ],
};
