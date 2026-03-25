import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['fixtures/**'],
    include: ['test/*.test.ts'],
    coverage: {
      exclude: ['bin/**', 'fixtures/**', 'test/**'],
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
})
