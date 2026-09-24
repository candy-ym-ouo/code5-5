import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  // 将工作区内包（contracts/game-core）一并打进产物，
  // 生产运行时只依赖 node:sqlite 这一内置模块。
  noExternal: [/.*/],
  external: ['node:sqlite'],
  banner: {
    js: `import { createRequire as __shanhaiCreateRequire } from 'node:module'; const require = __shanhaiCreateRequire(import.meta.url);`
  }
});
