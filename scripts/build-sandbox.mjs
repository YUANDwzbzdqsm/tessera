// Builds the sandbox worker into one self-contained classic script: packages/runtime/dist/sandbox-worker.js.
// The iframe sandbox has an opaque origin and can only start a worker from a Blob, so the worker must not
// import anything at run time. It is a classic (IIFE) script because a *module* worker loads with CORS checks
// that a Blob URL from an opaque origin fails ("load error"). Rebuild after changing packages/runtime/src
// (npm run build:sandbox).
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

export async function buildSandbox() {
  await build({
    configFile: false,
    logLevel: 'warn',
    define: { 'process.env.NODE_ENV': '"production"' },
    build: {
      lib: {
        entry: here('../packages/runtime/src/worker.ts'),
        formats: ['iife'],
        name: 'TesseraSandbox',
        fileName: () => 'sandbox-worker.js',
      },
      outDir: here('../packages/runtime/dist'),
      emptyOutDir: true,
      target: 'es2022',
      minify: 'esbuild',
      sourcemap: false,
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildSandbox();
  console.log('built packages/runtime/dist/sandbox-worker.js');
}
