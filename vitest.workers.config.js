import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
    test: {
        include: ['tests/worker/**/*.test.js'],
        poolOptions: {
            workers: {
                wrangler: { configPath: './worker/wrangler.toml' }
            }
        }
    }
})
