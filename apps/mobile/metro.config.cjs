const { resolve } = require('node:path');

const { getDefaultConfig } = require('expo/metro-config');

const { createResolveRequest } = require('./src/platform/resolve-request.cjs');

const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = createResolveRequest(
  resolve(__dirname, '../..'),
);

module.exports = config;
