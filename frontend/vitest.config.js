import { defineConfig } from 'vitest/config'
import viteConfig from './vite.config.js'

export default defineConfig({
  ...viteConfig,
  test: {
    environment: 'happy-dom',
    setupFiles: ['./test/setup.js']
  }
})
