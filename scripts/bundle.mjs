import { bundleSdk } from '@qvac/sdk/commands';
await bundleSdk({
  projectRoot: process.cwd(),
  configPath: './qvac.config.mjs',
  hosts: ['linux-x64'],
  quiet: true,
});
