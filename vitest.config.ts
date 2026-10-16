import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    environment: 'node',
    // Every test injects its own fake fetch / timers; nothing here reaches the network.
    testTimeout: 10_000,
  },
})
