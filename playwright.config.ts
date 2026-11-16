import { defineConfig } from '@playwright/test';
const external = process.env.PUZZLE_TEST_URL;
export default defineConfig({
  testDir: './tests/browser', timeout: 30000, fullyParallel: false,
  use: { baseURL: external || 'http://127.0.0.1:4173', headless: true, viewport: { width: 1440, height: 1000 }, channel: 'chrome', screenshot: 'only-on-failure' },
  webServer: external ? undefined : { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: true },
});
