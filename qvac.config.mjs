import { fileURLToPath } from 'node:url';

export default {
  plugins: ['@qvac/sdk/llamacpp-completion/plugin', '@qvac/sdk/llamacpp-decision/plugin'],
  cacheDirectory: fileURLToPath(new URL('./.qvac/models/', import.meta.url)),
  httpDownloadConcurrency: 2,
  httpConnectionTimeoutMs: 15000,
  // Measured native worker startup on WSL's /mnt/c exceeded the SDK's 30s default.
  rpcInitTimeoutMs: 120000,
  loggerLevel: 'warn',
  loggerConsoleOutput: true,
};
