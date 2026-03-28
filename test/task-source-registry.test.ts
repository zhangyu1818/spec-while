import { expect, test } from 'vitest'

import { getTaskSource } from '../src/task-sources/registry'

test('registry resolves spec-kit and rejects unknown sources', () => {
  expect(getTaskSource('spec-kit').name).toBe('spec-kit')
  expect(getTaskSource('openspec').name).toBe('openspec')
  expect(() => getTaskSource('wat')).toThrow(/unknown task source/i)
})
