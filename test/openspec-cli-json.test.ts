import { beforeEach, expect, test, vi } from 'vitest'

import {
  readOpenSpecApplyInstructions,
  readOpenSpecStatus,
} from '../src/task-sources/openspec/cli-json'

const mockExeca = vi.hoisted(() => vi.fn())

vi.mock('execa', () => {
  return {
    execa: mockExeca,
  }
})

beforeEach(() => {
  mockExeca.mockReset()
})

test('readOpenSpecApplyInstructions wraps parse failures with change context', async () => {
  mockExeca.mockResolvedValue({
    stdout: '- Generating apply instructions...\nnot-json',
  })

  await expect(
    readOpenSpecApplyInstructions({
      changeName: 'example-change',
      workspaceRoot: '/tmp/workspace',
    }),
  ).rejects.toThrow(
    'Failed to read OpenSpec apply instructions for example-change: OpenSpec CLI did not return JSON payload',
  )
})

test('readOpenSpecStatus wraps parse failures with change context', async () => {
  mockExeca.mockResolvedValue({
    stdout: '- Loading change status...\nnot-json',
  })

  await expect(
    readOpenSpecStatus({
      changeName: 'example-change',
      workspaceRoot: '/tmp/workspace',
    }),
  ).rejects.toThrow(
    'Failed to read OpenSpec status for example-change: OpenSpec CLI did not return JSON payload',
  )
})
