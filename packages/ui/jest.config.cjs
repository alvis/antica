const { dirname } = require('node:path');

const babelRuntimeRoot = dirname(
  require.resolve('@babel/runtime/package.json'),
);

module.exports = {
  preset: 'jest-expo',
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.spec.*',
    '!src/**/*.stories.{ts,tsx}',
    '!src/index.ts',
    '!src/**/*.d.ts',
  ],
  coverageThreshold: {
    global: { statements: 100, branches: 100, functions: 100, lines: 100 },
    './src/**/*.{ts,tsx}': {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
  },
  moduleNameMapper: {
    '^@babel/runtime/(.*)$': `${babelRuntimeRoot}/$1`,
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/src/**/*.spec.tsx'],
  testPathIgnorePatterns: ['\\.spec\\.int\\.tsx?$'],
  testTimeout: 60000,
};
