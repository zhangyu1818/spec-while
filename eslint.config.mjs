import { defineConfig } from '@zhangyu1818/eslint-config'

export default defineConfig(
  {
    presets: {
      node: true,
      typescript: {
        options: {
          project: './tsconfig.json',
          tsconfigRootDir: import.meta.dirname,
        },
      },
    },
  },
  [
    {
      ignores: ['.tmp-smoke-*/**'],
    },
    {
      files: ['**/*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}'],
      rules: {
        'max-lines': [
          'error',
          {
            max: 300,
            skipBlankLines: true,
            skipComments: true,
          },
        ],
      },
    },
  ],
)
