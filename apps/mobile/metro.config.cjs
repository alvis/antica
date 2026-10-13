const { existsSync } = require('node:fs');
const { dirname, resolve, sep } = require('node:path');

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const workspaceRoot = resolve(__dirname, '../..') + sep;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const sourcePath = context.originModulePath;

  if (
    sourcePath.startsWith(workspaceRoot) &&
    sourcePath.includes(`${sep}src${sep}`) &&
    /\.tsx?$/.test(sourcePath) &&
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js')
  ) {
    const sourceTarget = resolve(dirname(sourcePath), moduleName.slice(0, -3));

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

module.exports = config;
