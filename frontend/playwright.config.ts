import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'
const installedChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
  (process.platform === 'darwin' && existsSync(installedChrome) ? installedChrome : undefined)
export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: '../artifacts/browser-results',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:5173',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { executablePath },
  },
})
