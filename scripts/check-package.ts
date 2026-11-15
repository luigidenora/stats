/**
 * Checks the package as npm would publish it: the right files in the tarball, nothing private,
 * and a bundle that imports in Node without touching the DOM at load time.
 *
 * Run after `npm run build`: `node scripts/check-package.ts`.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

interface PackEntry {
  files: { path: string }[];
}

const REQUIRED = ['package.json', 'README.md', 'LICENSE', 'build/index.js', 'build/types/index.d.ts'];
const FORBIDDEN = [/^src\//, /^examples\//, /^preview\//, /^test\//, /^scripts\//, /^\.impeccable\//, /^site\//, /^docs\//];
const EXPORTS = ['Stats', 'MODES', 'createGlyph', 'createGlyphFromSpec', 'formatBytes', 'formatMs'];

const problems: string[] = [];

const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' });
const packed = (JSON.parse(output) as PackEntry[])[0].files.map((file) => file.path);

for (const path of REQUIRED) {
  if (!packed.includes(path)) problems.push(`missing from the tarball: ${path}`);
}

for (const path of packed) {
  if (FORBIDDEN.some((pattern) => pattern.test(path))) problems.push(`should not be published: ${path}`);
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as { repository?: { url?: string }; homepage?: string };
const links = `${manifest.repository?.url ?? ''} ${manifest.homepage ?? ''}`;
if (!links.includes('/stats')) problems.push(`repository / homepage do not point at this package: ${links}`);

const bundle = await import(pathToFileURL('build/index.js').href) as Record<string, unknown>;
for (const name of EXPORTS) {
  if (bundle[name] === undefined) problems.push(`build/index.js does not export ${name}`);
}

if (problems.length > 0) {
  console.error(`Package check failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

console.log(`Package check passed: ${packed.length} files, ${EXPORTS.length} exports verified.`);
