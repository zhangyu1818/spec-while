import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['fixtures/**'],
    include: ['test/*.test.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: [
        'bin/**',
        'fixtures/**',
        'test/**',
      ],
    },
  },
})
