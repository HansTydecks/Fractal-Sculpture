import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the built site works from any sub-path (e.g. GitHub Pages).
  base: './',
  // The geometry tests build whole sculptures; shared CI runners are several times slower.
  test: { testTimeout: 60_000 },
});
