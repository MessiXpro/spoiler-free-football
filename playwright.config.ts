import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${PORT}/`,
    trace: 'retain-on-failure',
    // 默认屏蔽 service worker，免得它绕过测试里的请求拦截；PWA 测试单独开启
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'web-desktop',
      testDir: './e2e/web',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      name: 'web-tablet',
      testDir: './e2e/web',
      // iPad 尺寸，使用 Chromium 内核
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 820, height: 1180 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'web-phone',
      testDir: './e2e/web',
      use: { ...devices['Pixel 7'] },
    },
    { name: 'extension', testDir: './e2e/extension', use: { ...devices['Desktop Chrome'] } },
    { name: 'userscript', testDir: './e2e/userscript', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'pnpm --filter @sff/web preview',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
