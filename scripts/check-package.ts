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

const REQUIRED = [
  'package.json', 'README.md', 'LICENSE', 'build/index.js', 'build/types/index.d.ts',
  'build/dev.js', 'build/noop.js', 'build/types/dev.d.ts', 'build/agent.js', 'build/types/agent.d.ts', 'build/probe.js', 'build/types/probe.d.ts'
];
/** The production stand-in must stay tiny: it is all a production bundle carries. */
const NOOP_MAX_BYTES = 2500;
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

// The no-op imports without a DOM and answers every public member of the real class.
const noopSource = readFileSync('build/noop.js', 'utf8');
if (noopSource.length > NOOP_MAX_BYTES) problems.push(`build/noop.js is ${noopSource.length} bytes (limit ${NOOP_MAX_BYTES})`);
if (/from\s*["']\.\/(index|dev|stats)/.test(noopSource)) problems.push('build/noop.js imports the real overlay');
const real = (bundle['Stats'] as { prototype: object }).prototype;
const noop = ((await import(pathToFileURL('build/noop.js').href) as Record<string, unknown>)['Stats'] as { prototype: object }).prototype;
const agent = await import(pathToFileURL('build/agent.js').href) as Record<string, unknown>;
if (typeof agent['agentTools'] !== 'function' || typeof agent['registerAgentTools'] !== 'function') problems.push('build/agent.js does not export agentTools and registerAgentTools');
const PUBLIC = ['begin', 'end', 'mark', 'event', 'snapshot', 'startRecording', 'stopRecording', 'defineMode', 'extendMode', 'addMetric', 'removeMetric', 'addControl', 'setControl', 'removeControl', 'addRule', 'dispose'];
for (const name of PUBLIC) {
  if (typeof (real as Record<string, unknown>)[name] !== 'function') problems.push(`Stats has no ${name}()`);
  if (typeof (noop as Record<string, unknown>)[name] !== 'function') problems.push(`the production no-op has no ${name}()`);
}

if (problems.length > 0) {
  console.error(`Package check failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

console.log(`Package check passed: ${packed.length} files, ${EXPORTS.length} exports verified.`);
