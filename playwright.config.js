import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: 'tests/e2e',
    timeout: 60_000,
    use: {
        baseURL: 'http://localhost:8000',
        headless: true,
        permissions: ['camera', 'microphone']
    },
    webServer: {
        command: 'npm run dev',
        url: 'http://localhost:8000',
        reuseExistingServer: true,
        timeout: 30_000
    }
});
