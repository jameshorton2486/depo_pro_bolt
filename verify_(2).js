#!/usr/bin/env node
// ============================================================================
// verify.js — Depo-Pro Simple migration verification
// ----------------------------------------------------------------------------
// Run from your project root with:
//
//     node verify.js
//
// Auto-detects which migration stage you're at (1 → 4), checks every file
// that should exist, every file that should be gone, runs the TypeScript
// compiler, and scans your source for forbidden imports. Exit code is 0 on
// success, 1 if any check fails.
//
// Zero dependencies — pure Node.js standard library. Works in bolt's
// WebContainer, in any local Node install (Mac/Linux/Windows), and in CI.
// ============================================================================

const fs = await import('fs').then(m => m.default);
const path = await import('path').then(m => m.default);
const { execSync } = await import('child_process');

const ROOT = process.cwd();
const c = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m', gray: '\x1b[90m', bold: '\x1b[1m',
};

const results = { pass: 0, fail: 0, warn: 0 };
const failures = [];

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
const isFile = rel => { try { return fs.statSync(path.join(ROOT, rel)).isFile(); } catch { return false; } };
const isDir  = rel => { try { return fs.statSync(path.join(ROOT, rel)).isDirectory(); } catch { return false; } };
const read   = rel => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return null; } };

const pass = msg                => { console.log(`  ${c.green}✓${c.reset} ${msg}`); results.pass++; };
const fail = (msg, hint)        => { console.log(`  ${c.red}✗${c.reset} ${msg}`);
                                     if (hint) console.log(`    ${c.gray}→ ${hint}${c.reset}`);
                                     results.fail++; failures.push(msg); };
const warn = (msg, hint)        => { console.log(`  ${c.yellow}⚠${c.reset} ${msg}`);
                                     if (hint) console.log(`    ${c.gray}→ ${hint}${c.reset}`);
                                     results.warn++; };
const info = msg                => console.log(`    ${c.gray}${msg}${c.reset}`);
const header = title            => console.log(`\n${c.bold}${c.cyan}━━ ${title} ━━${c.reset}`);

function walkTs(dir) {
  const out = [];
  function go(d) {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) go(full);
      else if (e.isFile() && /\.(ts|tsx)$/.test(e.name)) out.push(full);
    }
  }
  go(dir);
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// STAGE 1 — New files in place
// ────────────────────────────────────────────────────────────────────────────
function checkStage1() {
  header('STAGE 1 — New files in place');

  // Expected new files, with a content marker we can grep for to confirm
  // it isn't an empty placeholder or wrong-content file.
  const expected = [
    { path: 'src/lib/audioCompress.ts',          marker: 'compressAudio' },
    { path: 'src/lib/deepgramClient.ts',         marker: 'export async function transcribe' },
    { path: 'src/lib/localStore.ts',             marker: 'saveJob' },
    { path: 'src/components/SimpleTranscribe.tsx', marker: 'export default function SimpleTranscribe' },
    { path: 'src/App.tsx',                       marker: 'SimpleTranscribe' },
    { path: 'src/vite-env.d.ts',                 marker: 'vite/client' },
  ];

  for (const { path: p, marker } of expected) {
    if (!isFile(p)) {
      fail(`Missing: ${p}`, 'Create this file with the content from Claude');
      continue;
    }
    const content = read(p) || '';
    // vite-env.d.ts is intentionally a one-liner; everything else should
    // have real content.
    const minLength = p.endsWith('.d.ts') ? 20 : 50;
    if (content.length < minLength) {
      fail(`Empty or tiny: ${p}`, 'File exists but has no real content — re-paste it');
    } else if (!content.includes(marker)) {
      fail(`Wrong content: ${p}`, `Expected to find "${marker}" in the file`);
    } else {
      pass(p);
    }
  }

  // App.tsx must NOT still be importing the old TranscribeEngine
  const app = read('src/App.tsx') || '';
  if (app.includes("from './components/TranscribeEngine'")) {
    fail('src/App.tsx still imports the old TranscribeEngine',
         'Replace src/App.tsx with the new simplified version');
  }

  // .env / API key
  const env = read('.env');
  if (!env) {
    fail('.env file missing in project root',
         'Create it with one line: VITE_DEEPGRAM_API_KEY=dg_your_actual_key');
  } else {
    const match = env.match(/^\s*VITE_DEEPGRAM_API_KEY\s*=\s*(.+?)\s*$/m);
    if (!match) {
      fail('VITE_DEEPGRAM_API_KEY not found in .env',
           'Add: VITE_DEEPGRAM_API_KEY=dg_your_actual_key');
    } else {
      const key = match[1].replace(/^["']|["']$/g, '').trim();
      if (!key || key === 'your_deepgram_api_key_here' || key === 'your_key' || key.startsWith('<')) {
        warn('VITE_DEEPGRAM_API_KEY is still a placeholder',
             'Get a real key from console.deepgram.com');
      } else if (key.length < 30) {
        warn(`VITE_DEEPGRAM_API_KEY looks short (${key.length} chars)`,
             'Deepgram API keys are typically 40+ chars — double-check it');
      } else {
        pass(`VITE_DEEPGRAM_API_KEY set (${key.length} chars)`);
      }
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// BUILD — npm install + tsc
// ────────────────────────────────────────────────────────────────────────────
function checkBuild() {
  header('BUILD — npm install + TypeScript');

  if (!isDir('node_modules')) {
    fail('node_modules not present', 'Run: npm install');
    return;
  }
  pass('node_modules present');

  if (!isFile('node_modules/typescript/bin/tsc') && !isFile('node_modules/.bin/tsc')) {
    fail('typescript not installed', 'Run: npm install');
    return;
  }
  pass('typescript installed');

  console.log(`    ${c.gray}Running tsc --noEmit (5-15s)...${c.reset}`);
  try {
    execSync('npx -y tsc --noEmit -p tsconfig.app.json', { stdio: 'pipe', cwd: ROOT });
    pass('TypeScript compiles cleanly');
  } catch (err) {
    const out = (err.stdout?.toString() || '') + (err.stderr?.toString() || '');
    const lines = out.split('\n').filter(Boolean).slice(0, 8);
    fail('TypeScript errors found');
    for (const line of lines) info(line);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// STAGE 3 — Old files removed
// ────────────────────────────────────────────────────────────────────────────
function checkStage3() {
  header('STAGE 3 — Old files removed');

  const oldFiles = [
    'src/components/TranscribeEngine.tsx',
    'src/components/TranscribeEngine copy.tsx',
    'src/components/CaseIntake.tsx',
    'src/components/JobDashboard.tsx',
    'src/components/TemplateConfig.tsx',
    'src/components/AiReviewPanel.tsx',
    'src/components/TranscriptEditor.tsx',
    'src/components/Icons.tsx',
    'src/lib/supabase.ts',
    'src/lib/database.types.ts',
  ];
  const oldDirs = [
    'src/components/diff',
    'src/components/review',
    'src/lib/diff',
    'supabase',
  ];

  const presentFiles = oldFiles.filter(isFile);
  const presentDirs = oldDirs.filter(isDir);
  const totalPresent = presentFiles.length + presentDirs.length;

  if (totalPresent === 0) {
    pass('All old Supabase-era files removed');
  } else {
    warn(`${totalPresent} old item(s) still present — Stage 3 not done yet`);
    for (const f of presentFiles) info(`• ${f}`);
    for (const d of presentDirs)  info(`• ${d}/`);
  }

  // corrections.ts must SURVIVE Stage 3 — we keep it for later integration
  if (isFile('src/lib/corrections.ts')) {
    pass('src/lib/corrections.ts preserved (correct — keep this)');
  } else if (totalPresent === 0) {
    warn('src/lib/corrections.ts is missing',
         'Restore it from your zip backup — useful for Stage 5');
  }
}

// ────────────────────────────────────────────────────────────────────────────
// STAGE 4 — package.json cleanup
// ────────────────────────────────────────────────────────────────────────────
function checkStage4() {
  header('STAGE 4 — package.json slimmed');

  const pkgRaw = read('package.json');
  if (!pkgRaw) { fail('package.json missing'); return; }
  let pkg;
  try { pkg = JSON.parse(pkgRaw); }
  catch (e) { fail('package.json is not valid JSON', e.message); return; }

  const shouldBeGone = [
    '@supabase/supabase-js',
    '@tanstack/react-virtual',
    'lucide-react',
    'pdfjs-dist',
    'tus-js-client',
    'wavesurfer.js',
  ];
  const deps = pkg.dependencies || {};
  const stillThere = shouldBeGone.filter(d => deps[d]);

  if (stillThere.length === 0) {
    pass('All unnecessary packages removed');
  } else {
    warn(`${stillThere.length} unnecessary package(s) still in dependencies`);
    for (const d of stillThere) info(`• ${d}`);
  }

  // Required packages must remain
  for (const required of ['react', 'react-dom', '@ffmpeg/ffmpeg', '@ffmpeg/util']) {
    if (!deps[required]) fail(`Required package missing: ${required}`,
                              `Run: npm install ${required}`);
  }

  // Final ideal state
  const finalDeps = Object.keys(deps).sort();
  const expectedFinal = ['@ffmpeg/ffmpeg', '@ffmpeg/util', 'react', 'react-dom'];
  if (JSON.stringify(finalDeps) === JSON.stringify(expectedFinal)) {
    pass(`dependencies trimmed to: { react, react-dom, @ffmpeg/ffmpeg, @ffmpeg/util } — perfect`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// VITE CONFIG — required headers for ffmpeg.wasm
// ────────────────────────────────────────────────────────────────────────────
function checkViteConfig() {
  header('VITE CONFIG — ffmpeg.wasm requirements');

  const cfg = read('vite.config.ts') || read('vite.config.js');
  if (!cfg) {
    fail('vite.config.ts not found');
    return;
  }

  const hasCOOP = /Cross-Origin-Opener-Policy.*same-origin/s.test(cfg);
  const hasCOEP = /Cross-Origin-Embedder-Policy.*require-corp/s.test(cfg);

  if (hasCOOP && hasCOEP) {
    pass('Cross-origin isolation headers present (COOP + COEP)');
  } else {
    fail('vite.config.ts missing COOP/COEP headers',
         'ffmpeg.wasm needs SharedArrayBuffer — replace vite.config.ts with the version from Claude');
  }

  if (cfg.includes("'@ffmpeg/ffmpeg'") && cfg.includes('optimizeDeps')) {
    pass('@ffmpeg packages excluded from Vite pre-bundle');
  } else {
    warn('@ffmpeg packages not in optimizeDeps.exclude',
         'May cause slow dev startup — add them to optimizeDeps.exclude in vite.config.ts');
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ARCHITECTURE — no forbidden imports anywhere in src/
// ----------------------------------------------------------------------------
// Only scans files that are part of the NEW architecture. The old Supabase-
// era components are expected to import forbidden packages until they're
// deleted in Stage 3 — flagging them here would be noise.
// ────────────────────────────────────────────────────────────────────────────
function checkForbiddenImports() {
  header('ARCHITECTURE — no Supabase/TUS/etc imports in new code');

  const forbidden = [
    '@supabase/supabase-js',
    'tus-js-client',
    'wavesurfer.js',
    'pdfjs-dist',
    'lucide-react',
    '@tanstack/react-virtual',
  ];

  // Old files that we EXPECT to import forbidden packages — skip them until
  // Stage 3 deletes them. Listed by glob-like prefix.
  const oldCodePrefixes = [
    'src/components/TranscribeEngine',
    'src/components/CaseIntake',
    'src/components/JobDashboard',
    'src/components/TemplateConfig',
    'src/components/AiReviewPanel',
    'src/components/TranscriptEditor',
    'src/components/Icons',
    'src/components/diff/',
    'src/components/review/',
    'src/lib/supabase',
    'src/lib/database.types',
    'src/lib/diff/',
  ];
  const isOldFile = relPath =>
    oldCodePrefixes.some(prefix => relPath.replace(/\\/g, '/').startsWith(prefix));

  const allFiles = walkTs(path.join(ROOT, 'src'));
  if (allFiles.length === 0) {
    fail('No .ts/.tsx files found under src/',
         'Are you running this from the project root?');
    return;
  }

  const filesToScan = allFiles.filter(f => !isOldFile(path.relative(ROOT, f)));
  const skipped = allFiles.length - filesToScan.length;

  const violations = [];
  for (const f of filesToScan) {
    const content = fs.readFileSync(f, 'utf8');
    for (const pkg of forbidden) {
      const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?:import|from)\\s+[^;]*['"\`]${escaped}(?:/[^'"\`]*)?['"\`]`, 'm');
      if (re.test(content)) {
        violations.push({ file: path.relative(ROOT, f), pkg });
      }
    }
  }

  const suffix = skipped > 0 ? ` (${skipped} old file${skipped !== 1 ? 's' : ''} skipped — will be deleted in Stage 3)` : '';
  if (violations.length === 0) {
    pass(`Scanned ${filesToScan.length} new file(s)${suffix} — no forbidden imports`);
  } else {
    fail(`${violations.length} new file(s) import removed packages`);
    for (const v of violations) info(`• ${v.file} → ${v.pkg}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Stage detection — figure out where the user is
// ────────────────────────────────────────────────────────────────────────────
function detectStage() {
  const newFilesPresent =
    isFile('src/lib/audioCompress.ts') &&
    isFile('src/lib/deepgramClient.ts') &&
    isFile('src/lib/localStore.ts') &&
    isFile('src/components/SimpleTranscribe.tsx') &&
    (read('src/App.tsx') || '').includes('SimpleTranscribe');

  const oldFilesGone =
    !isFile('src/components/TranscribeEngine.tsx') &&
    !isDir('supabase') &&
    !isFile('src/lib/supabase.ts');

  let pkg = {};
  try { pkg = JSON.parse(read('package.json') || '{}'); } catch {}
  const deps = pkg.dependencies || {};
  const cleanDeps =
    !deps['@supabase/supabase-js'] &&
    !deps['tus-js-client'] &&
    !deps['pdfjs-dist'];

  if (!newFilesPresent) return { name: 'Stage 0 — not started', emoji: '○', color: c.gray };
  if (!oldFilesGone)    return { name: 'Stage 1-2 — new files in, old files still present', emoji: '◐', color: c.yellow };
  if (!cleanDeps)       return { name: 'Stage 3 — source cleaned, package.json not yet', emoji: '◑', color: c.blue };
  return                       { name: 'Stage 4 — fully migrated',                               emoji: '●', color: c.green };
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────
console.log(`${c.bold}${c.blue}╔═══════════════════════════════════════════════╗${c.reset}`);
console.log(`${c.bold}${c.blue}║  Depo-Pro Simple — Migration Verifier         ║${c.reset}`);
console.log(`${c.bold}${c.blue}╚═══════════════════════════════════════════════╝${c.reset}`);
console.log(`${c.gray}  Running in: ${ROOT}${c.reset}`);

checkStage1();
checkBuild();
checkViteConfig();
checkStage3();
checkStage4();
checkForbiddenImports();

const stage = detectStage();

console.log(`\n${c.bold}━━ Summary ━━${c.reset}`);
console.log(`  ${c.green}${results.pass} passed${c.reset}` +
            (results.warn ? `   ${c.yellow}${results.warn} warning${results.warn !== 1 ? 's' : ''}${c.reset}` : '') +
            (results.fail ? `   ${c.red}${results.fail} failed${c.reset}` : ''));
console.log(`\n  ${stage.color}${stage.emoji} ${c.bold}${stage.name}${c.reset}`);

if (results.fail > 0) {
  console.log(`\n  ${c.red}Fix the failures above before moving to the next stage.${c.reset}\n`);
  process.exit(1);
} else if (results.warn > 0) {
  console.log(`\n  ${c.yellow}Working but with warnings — review them above.${c.reset}\n`);
  process.exit(0);
} else {
  console.log(`\n  ${c.green}Everything checks out.${c.reset}\n`);
  process.exit(0);
}
