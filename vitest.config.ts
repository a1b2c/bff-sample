import { defineConfig } from 'vitest/config';

// Vitest defaults already fit: Node environment, no globals (import from 'vitest'),
// and any *.test.ts file is picked up, e.g. features/auth/test/auth.service.test.ts.
export default defineConfig({
  test: {
    // Each workspace package is its own project, named after its package.json "name"
    projects: ['packages/*', 'features/*', 'infra'],

    // Test folders are empty for now: don't fail `pnpm check` until tests exist
    passWithNoTests: true,
  },
});
