import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFarewell } from '../src/farewell'

test('buildFarewell returns a friendly farewell', () => {
  assert.equal(buildFarewell('Ada'), 'Bye, Ada!')
})
