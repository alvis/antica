import { resolve } from 'node:path';

import { describe, expect, it, jest } from '@jest/globals';

import { createResolveRequest } from './resolve-request.cjs';

import type { CustomResolver, Resolution } from './resolve-request.cjs';

const workspaceRoot = resolve(__dirname, '../../../..');
const shim = resolve(
  workspaceRoot,
  'apps/mobile/src/platform/react-native.cjs',
);
const original: Resolution = { type: 'empty' };

/** one import as Metro asks the workspace resolver about it */
interface Request {
  /** workspace root the resolver is built for */
  readonly root: string;
  /** importing file, relative to that root */
  readonly origin: string;
  /** what the file imports */
  readonly moduleName: string;
  /** Metro's target platform */
  readonly platform: string | null;
}

/**
 * resolves one import the way Metro asks the workspace resolver
 * @param request the import
 * @param request.root workspace root the resolver is built for
 * @param request.origin importing file, relative to that root
 * @param request.moduleName what the file imports
 * @param request.platform Metro's target platform
 * @returns the resolution and the default resolver's calls
 */
function resolveFrom({ root, origin, moduleName, platform }: Request): {
  resolution: Resolution;
  fallback: jest.Mock<CustomResolver>;
} {
  const fallback = jest.fn<CustomResolver>(() => original);
  const resolution = createResolveRequest(root)(
    { originModulePath: resolve(root, origin), resolveRequest: fallback },
    moduleName,
    platform,
  );

  return { resolution, fallback };
}

describe('fn:createResolveRequest', () => {
  it('should give the app and the UI package the Android Text', () => {
    for (const origin of [
      'apps/mobile/src/features/today/components/TodayGreeting.tsx',
      'packages/ui/src/SegmentControl.tsx',
    ]) {
      expect(
        resolveFrom({
          root: workspaceRoot,
          origin,
          moduleName: 'react-native',
          platform: 'android',
        }).resolution,
      ).toEqual({ type: 'sourceFile', filePath: shim });
    }
  });

  it('should keep the original module everywhere else', () => {
    for (const [origin, platform] of [
      ['apps/mobile/src/features/today/components/TodayGreeting.tsx', 'ios'],
      ['apps/mobile/src/features/today/components/TodayGreeting.tsx', null],
      ['apps/mobile/src/platform/glyph-safe-text.tsx', 'android'],
      ['apps/mobile/src/platform/react-native.cjs', 'android'],
      ['node_modules/expo-router/build/index.js', 'android'],
      ['packages/client/src/index.ts', 'android'],
      ['apps/mobile/app.config.ts', 'android'],
    ] as const) {
      const { resolution, fallback } = resolveFrom({
        root: workspaceRoot,
        origin,
        moduleName: 'react-native',
        platform,
      });

      expect(resolution).toBe(original);
      expect(fallback).toHaveBeenCalledWith(
        expect.anything(),
        'react-native',
        platform,
      );
    }
  });

  it('should match source by its path inside the checkout, not by folders above it', () => {
    const nested = '/home/src/antica';

    expect(
      resolveFrom({
        root: nested,
        origin: 'tooling/run-maestro.ts',
        moduleName: 'react-native',
        platform: 'android',
      }).resolution,
    ).toBe(original);
    expect(
      resolveFrom({
        root: nested,
        origin: 'packages/ui/src/Card.tsx',
        moduleName: 'react-native',
        platform: 'android',
      }).resolution,
    ).toEqual({
      type: 'sourceFile',
      filePath: resolve(nested, 'apps/mobile/src/platform/react-native.cjs'),
    });
  });

  it('should resolve a `.js` sibling import to its TypeScript source', () => {
    const { fallback } = resolveFrom({
      root: workspaceRoot,
      origin: 'packages/ui/src/index.ts',
      moduleName: './faces.js',
      platform: 'android',
    });

    expect(fallback).toHaveBeenCalledWith(
      expect.anything(),
      './faces.ts',
      'android',
    );
  });
});
