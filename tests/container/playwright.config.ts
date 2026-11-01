import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'browser.spec.ts',
  timeout: 30_000,
  workers: 1,
  reporter: 'list',
  outputDir: '../../output/playwright/container-lifecycle',
  use: { headless: true, trace: 'off', screenshot: 'only-on-failure' }
});
