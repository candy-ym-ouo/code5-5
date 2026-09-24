import { defineConfig } from 'tsup';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  // node:sqlite 是 Node 内置模块，保持外部；workspace 包（main 指向 .ts 源码）需要一起打包。
  external: ['node:sqlite'],
  noExternal: [/@shanhai\//],
  esbuildPlugins: [
    {
      name: 'shanhai-workspace-sources',
      setup(build) {
        build.onResolve({ filter: /^@shanhai\/(contracts|game-core)$/ }, (args) => {
          const pkg = args.path === '@shanhai/contracts' ? 'contracts' : 'game-core';
          return { path: path.resolve(here, '..', '..', 'packages', pkg, 'src', 'index.ts') };
        });
      }
    }
  ]
});
