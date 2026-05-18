// verify.js — DEPO-PRO migration stage checker
// Usage: node verify.js
// No dependencies required — pure Node standard library.

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const green  = s => `\x1b[32m${s}\x1b[0m`;
const red    = s => `\x1b[31m${s}\x1b[0m`;
const yellow = s => `\x1b[33m${s}\x1b[0m`;
const cyan   = s => `\x1b[36m${s}\x1b[0m`;
const bold   = s => `\x1b[1m${s}\x1b[0m`;
const dim    = s => `\x1b[2m${s}\x1b[0m`;

const PASS = green('  PASS');
const FAIL = red('  FAIL');
const WARN = yellow('  WARN');
const INFO = dim('  INFO');

let totalPass = 0;
let totalFail = 0;

function check(label, pass, detail = '') {
  if (pass) {
    console.log(`${PASS}  ${label}${detail ? dim('  ' + detail) : ''}`);
    totalPass++;
  } else {
    console.log(`${FAIL}  ${label}${detail ? '  ' + red(detail) : ''}`);
    totalFail++;
  }
  return pass;
}

function info(label, detail = '') {
  console.log(`${INFO}  ${label}${detail ? dim('  ' + detail) : ''}`);
}

function section(title) {
  console.log('\n' + bold(cyan('── ' + title + ' ')).padEnd(70, '─'));
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function read(rel) {
  try { return fs.readFileSync(path.join(root, rel), 'utf8'); }
  catch { return ''; }
}

function sizeOf(rel) {
  try { return fs.statSync(path.join(root, rel)).size; }
  catch { return 0; }
}

// ─── Stage 1: New files present and valid ────────────────────────────────────

section('STAGE 1 — New architecture files');

const newFiles = [
  {
    rel: 'src/App.tsx',
    minBytes: 800,
    mustNotContain: ["from './lib/supabase'", "from './lib/database.types'", "TranscribeEngine"],
    label: 'App.tsx — simplified (no Supabase)',
  },
  {
    rel: 'src/components/SimpleTranscribe.tsx',
    minBytes: 3000,
    mustContain: ['compressAudio', 'transcribe', 'saveJob'],
    label: 'SimpleTranscribe.tsx — exists and has core logic',
  },
  {
    rel: 'src/lib/audioCompress.ts',
    minBytes: 2000,
    mustContain: ['OfflineAudioContext', 'audioBufferToWav'],
    label: 'audioCompress.ts — Web Audio pipeline',
  },
  {
    rel: 'src/lib/deepgramClient.ts',
    minBytes: 2000,
    mustContain: ['DeepgramOptions', 'parseUtterances', 'transcribe'],
    label: 'deepgramClient.ts — sync transcription client',
  },
  {
    rel: 'src/lib/localStore.ts',
    minBytes: 2000,
    mustContain: ['IndexedDB', 'saveJob', 'saveUtterances', 'updateUtterance'],
    label: 'localStore.ts — IndexedDB wrapper',
  },
];

for (const f of newFiles) {
  if (!exists(f.rel)) {
    check(f.label, false, 'file missing');
    continue;
  }
  const content = read(f.rel);
  const size = sizeOf(f.rel);
  if (size < f.minBytes) {
    check(f.label, false, `only ${size} bytes — file may be empty or wrong content`);
    continue;
  }
  if (f.mustContain) {
    const missing = f.mustContain.filter(s => !content.includes(s));
    if (missing.length) {
      check(f.label, false, `missing expected token: ${missing[0]}`);
      continue;
    }
  }
  if (f.mustNotContain) {
    const found = f.mustNotContain.filter(s => content.includes(s));
    if (found.length) {
      check(f.label, false, `still contains old code: ${found[0]}`);
      continue;
    }
  }
  check(f.label, true);
}

// .env check
{
  const envContent = read('.env');
  const hasKey = envContent.includes('VITE_DEEPGRAM_API_KEY=') &&
    !envContent.includes('VITE_DEEPGRAM_API_KEY=your_') &&
    !envContent.includes('VITE_DEEPGRAM_API_KEY=<') &&
    envContent.match(/VITE_DEEPGRAM_API_KEY=\S{8,}/);
  check('.env — VITE_DEEPGRAM_API_KEY is set (non-placeholder)', !!hasKey,
    hasKey ? '' : 'add VITE_DEEPGRAM_API_KEY=<your key> to .env');
}

// corrections.ts — must be KEPT (not deleted)
check(
  'src/lib/corrections.ts — preserved (contains reusable correction logic)',
  exists('src/lib/corrections.ts'),
  exists('src/lib/corrections.ts') ? '' : 'this file should be kept — do not delete it'
);

// ─── Stage 2: Build passes ────────────────────────────────────────────────────

section('STAGE 2 — Build');

const hasNodeModules = exists('node_modules');
check('node_modules present', hasNodeModules, hasNodeModules ? '' : 'run: npm install');

if (hasNodeModules) {
  try {
    execSync('npx tsc --noEmit -p tsconfig.app.json 2>&1', {
      cwd: root,
      stdio: 'pipe',
      timeout: 30000,
    });
    check('TypeScript — no type errors', true);
  } catch (err) {
    const output = err.stdout?.toString() ?? err.stderr?.toString() ?? '';
    const firstLines = output.split('\n').slice(0, 6).join('\n');
    check('TypeScript — no type errors', false, '\n' + red(firstLines));
  }

  try {
    execSync('npm run build 2>&1', { cwd: root, stdio: 'pipe', timeout: 60000 });
    check('Vite build — succeeds', true);
  } catch (err) {
    const output = err.stdout?.toString() ?? '';
    const firstLines = output.split('\n').slice(0, 8).join('\n');
    check('Vite build — succeeds', false, '\n' + red(firstLines));
  }
}

// ─── Stage 3: Old files removed ───────────────────────────────────────────────

section('STAGE 3 — Old files / folders deleted');

const toDelete = [
  { rel: 'src/components/TranscribeEngine.tsx',         label: 'TranscribeEngine.tsx' },
  { rel: 'src/components/TranscribeEngine copy.tsx',    label: 'TranscribeEngine copy.tsx' },
  { rel: 'src/components/CaseIntake.tsx',               label: 'CaseIntake.tsx' },
  { rel: 'src/components/JobDashboard.tsx',             label: 'JobDashboard.tsx' },
  { rel: 'src/components/TemplateConfig.tsx',           label: 'TemplateConfig.tsx' },
  { rel: 'src/components/AiReviewPanel.tsx',            label: 'AiReviewPanel.tsx' },
  { rel: 'src/components/TranscriptEditor.tsx',         label: 'TranscriptEditor.tsx' },
  { rel: 'src/components/Icons.tsx',                    label: 'Icons.tsx' },
  { rel: 'src/components/SimpleTranscribe copy.tsx',    label: 'SimpleTranscribe copy.tsx' },
  { rel: 'src/components/diff',                         label: 'src/components/diff/ (folder)' },
  { rel: 'src/components/review',                       label: 'src/components/review/ (folder)' },
  { rel: 'src/lib/diff',                                label: 'src/lib/diff/ (folder)' },
  { rel: 'src/lib/database.types.ts',                   label: 'database.types.ts' },
  { rel: 'src/lib/supabase.ts',                         label: 'supabase.ts' },
  { rel: 'supabase',                                    label: 'supabase/ (entire folder)' },
  { rel: 'src/App copy.tsx',                            label: 'App copy.tsx' },
];

let oldFilesRemaining = 0;
for (const item of toDelete) {
  const present = exists(item.rel);
  if (present) {
    oldFilesRemaining++;
    console.log(`${WARN}  ${item.label}  ${dim('— still present, delete when ready')}`);
  } else {
    console.log(`${PASS}  ${item.label}  ${dim('— deleted')}`);
    totalPass++;
  }
}

if (oldFilesRemaining === 0) {
  info(`All ${toDelete.length} old items removed`);
} else {
  info(`${oldFilesRemaining} of ${toDelete.length} old items still present — safe to delete after Stage 2 testing`);
}

// ─── Stage 4: package.json dependencies trimmed ───────────────────────────────

section('STAGE 4 — package.json cleanup');

const pkgRaw = read('package.json');
const pkg = JSON.parse(pkgRaw || '{}');
const deps = pkg.dependencies ?? {};

const toRemove = [
  '@supabase/supabase-js',
  '@tanstack/react-virtual',
  'lucide-react',
  'pdfjs-dist',
  'tus-js-client',
  'wavesurfer.js',
];

let removedCount = 0;
for (const dep of toRemove) {
  const present = dep in deps;
  if (!present) {
    removedCount++;
    console.log(`${PASS}  ${dep}  ${dim('— removed')}`);
    totalPass++;
  } else {
    console.log(`${WARN}  ${dep}  ${dim('— still in dependencies')}`);
  }
}

if (removedCount === toRemove.length) {
  info('All 6 unused packages removed from package.json');
} else {
  info(`${toRemove.length - removedCount} package(s) left to remove from package.json after Stage 3`);
}

// ─── Architecture: no forbidden imports in new files ─────────────────────────

section('ARCHITECTURE — No forbidden imports in new code');

const NEW_CODE_PATHS = [
  'src/App.tsx',
  'src/components/SimpleTranscribe.tsx',
  'src/lib/audioCompress.ts',
  'src/lib/deepgramClient.ts',
  'src/lib/localStore.ts',
  'src/lib/corrections.ts',
];

const FORBIDDEN = [
  { pattern: '@supabase/supabase-js',    label: 'Supabase client' },
  { pattern: 'tus-js-client',            label: 'TUS uploader' },
  { pattern: 'wavesurfer',               label: 'WaveSurfer' },
  { pattern: 'pdfjs-dist',               label: 'PDF.js' },
  { pattern: '@tanstack/react-virtual',  label: 'React Virtual' },
  { pattern: 'lucide-react',             label: 'Lucide icons' },
];

let archClean = true;
for (const filePath of NEW_CODE_PATHS) {
  if (!exists(filePath)) continue;
  const content = read(filePath);
  for (const { pattern, label } of FORBIDDEN) {
    if (content.includes(pattern)) {
      check(`${filePath} — no ${label} import`, false, `found: ${pattern}`);
      archClean = false;
    }
  }
}
if (archClean) {
  check('New files — no forbidden imports', true);
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('\n' + bold('─'.repeat(60)));

const stage1Done = !newFiles.some(f => {
  const content = read(f.rel);
  return !exists(f.rel) || sizeOf(f.rel) < f.minBytes ||
    (f.mustContain && f.mustContain.some(s => !content.includes(s))) ||
    (f.mustNotContain && f.mustNotContain.some(s => content.includes(s)));
});
const stage3Done = oldFilesRemaining === 0;
const stage4Done = removedCount === toRemove.length;

let stageLabel, stageDesc;
if (!stage1Done) {
  stageLabel = '○  Stage 0';
  stageDesc  = 'Not started — copy in the new files to begin';
} else if (!stage3Done) {
  stageLabel = '◐  Stage 1-2';
  stageDesc  = 'New files in place, old files still present — safe to test';
} else if (!stage4Done) {
  stageLabel = '◑  Stage 3';
  stageDesc  = 'Source cleaned — remove unused packages from package.json';
} else {
  stageLabel = '●  Stage 4';
  stageDesc  = 'Fully migrated';
}

const color = totalFail === 0 ? green : red;
console.log(bold(color(`\n  ${stageLabel}`)) + `  ${dim(stageDesc)}`);
console.log(dim(`  ${totalPass} passed, ${totalFail} failed\n`));

process.exit(totalFail > 0 ? 1 : 0);
