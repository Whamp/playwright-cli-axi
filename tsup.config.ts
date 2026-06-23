import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { 'playwright-cli-axi': 'src/bin/playwright-cli-axi.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  dts: true,
  outDir: 'dist/bin',
  splitting: false
});
