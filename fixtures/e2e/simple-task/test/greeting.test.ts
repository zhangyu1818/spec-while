import assert from 'node:assert/strict'
import test from 'node:test'

import { buildGreeting } from '../src/greeting'

test('buildGreeting returns a friendly greeting', () => {
  assert.equal(buildGreeting('Ada'), 'Hello, Ada!')
})
