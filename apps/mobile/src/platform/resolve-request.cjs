// Metro's module resolution for this workspace (metro.config.cjs), kept beside the shim it points
// at so jest can exercise it (resolve-request.spec.ts).
const { existsSync } = require('node:fs');
const { dirname, relative, resolve, sep } = require('node:path');

// source whose `react-native` imports take the Android Text, relative to the workspace root
const androidTextSources = ['apps/mobile/src/', 'packages/ui/src/'];
// the shim and the Text it wraps import the original module
const platformSource = 'apps/mobile/src/platform/';

/**
 * builds Metro's resolveRequest for the workspace
 * @param {string} workspaceRoot absolute path of the repository root
 * @returns {import('./resolve-request.d.cts').CustomResolver} the resolver
 */
function createResolveRequest(workspaceRoot) {
  const androidReactNative = resolve(
    workspaceRoot,
    platformSource,
    'react-native.cjs',
  );

  return (context, moduleName, platform) => {
    const sourcePath = context.originModulePath;
    // posix-style and relative, so folders above the checkout never match
    const source = relative(workspaceRoot, sourcePath).split(sep).join('/');
    const inWorkspaceSource =
      !source.startsWith('../') &&
      !source.split('/').includes('node_modules') &&
      /(?:^|\/)src\//u.test(source);

    // Android: the app's and the UI package's own source take a Text that keeps the last serif
    // glyph on its line (glyph-safe-text.tsx); dependencies and the shim itself keep the original
    if (
      platform === 'android' &&
      moduleName === 'react-native' &&
      androidTextSources.some((prefix) => source.startsWith(prefix)) &&
      !source.startsWith(platformSource)
    ) {
      return { type: 'sourceFile', filePath: androidReactNative };
    }

    // workspace TypeScript imports its siblings with the `.js` suffix Node's ESM needs
    if (
      inWorkspaceSource &&
      /\.tsx?$/u.test(sourcePath) &&
      moduleName.startsWith('.') &&
      moduleName.endsWith('.js')
    ) {
      const sourceTarget = resolve(
        dirname(sourcePath),
        moduleName.slice(0, -3),
      );

      for (const extension of ['.ts', '.tsx']) {
        if (existsSync(sourceTarget + extension)) {
          return context.resolveRequest(
            context,
            moduleName.slice(0, -3) + extension,
            platform,
          );
        }
      }
    }

    return context.resolveRequest(context, moduleName, platform);
  };
}

module.exports = { createResolveRequest };
