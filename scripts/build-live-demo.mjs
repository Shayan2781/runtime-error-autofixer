import * as esbuild from 'esbuild';
import { mkdirSync } from 'fs';

const appDir = 'examples/live-demo';
const outDir = `${appDir}/dist`;

mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [`${appDir}/src/app.js`],
  bundle: true,
  minify: true,
  sourcemap: true,
  outfile: `${outDir}/app.bundle.js`,
  target: ['es2020'],
  format: 'iife',
});

console.log(`Built ${outDir}/app.bundle.js (+ .map)`);
