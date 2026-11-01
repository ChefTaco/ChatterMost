import { defineConfig, devices } from '@playwright/test';

const port = 8097;
const runId = Date.now();

export default defineConfig({
  testDir: 'tests/playwright',
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  outputDir: 'output/playwright/test-results',
  reporter: [['list'], ['html', { outputFolder: 'output/playwright/report', open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1360, height: 900 }
  },
  webServer: {
    command: 'npm run dev',
    url: `http://127.0.0.1:${port}/api/v4/system/ping`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: 'test',
      ENABLE_DEV_DEFAULTS: 'true',
      PORT: String(port),
      SERVER_URL: `http://127.0.0.1:${port}`,
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'AdminChangeMe123!',
      ADMIN_EMAIL: 'admin@example.test',
      COOKIE_SECRET: 'playwright-cookie-secret-with-enough-entropy',
      STORE_PATH: `./data/playwright-store-${runId}.json`,
      FILE_STORAGE_PATH: `./data/playwright-files-${runId}`,
      PROFILE_IMAGE_STORAGE_PATH: `./data/playwright-profile-images-${runId}`,
      HERMES_BOT_TOKEN: 'playwright-hermes-token',
      RATE_LIMIT_LOGIN_SOURCE_MAX: '1000',
      RATE_LIMIT_LOGIN_ACCOUNT_MAX: '1000',
      ALLOW_VERSION_ADVERTISEMENT: 'true'
    }
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
