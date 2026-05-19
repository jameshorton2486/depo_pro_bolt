# 20 — Phase 2: Visual Chrome

**Purpose.** Rewrite `App.tsx` so the React app has a proper five-stage progression bar, layer badges in the header, and a persistent footer. After this phase, the app looks like the prototype you designed.

**Time estimate.** 90 minutes.

**Prerequisites.** Phase 0 complete (app runs locally). Phase 0.5 complete (CLAUDE.md and assets in place). Phase 1 can be deferred.

---

## What changes

This phase changes the top-level chrome — the persistent header, navigation, and footer. The two existing tabs (Case Intake and Transcribe) become stages 1 and 2 of a five-stage flow. Stages 3, 4, and 5 are added as placeholders that display a "Coming in a later phase" message.

After this phase:

- Header shows: logo + case context + layer badges
- Below header: five-stage progression bar (1 → 2 → 3 → 4 → 5)
- Main area: the active stage's content
- Below main: a persistent footer with the "AI may suggest, humans certify" reminder
- Existing Case Intake and Transcribe screens are unchanged in this phase — only the chrome around them changes

---

## Step 1 — Add the layer state to the data model

Before changing UI, we need a way to track which stage and layer the current job is on. Open `src/types/intake.ts` and look at the bottom for the `IntakeRecord` interface. We'll add a few fields to extend it.

But we have an interleaving problem: the existing code uses `IntakeRecord`, not yet the full `Job` type from `03_TRANSCRIPT_MODEL.md`. For this phase, we'll use a simpler approach: track stage and layer as React state in `App.tsx`. We'll consolidate into a proper `Job` type in Phase 4 (Workspace Shell).

So no changes to types in this phase. Move to Step 2.

---

## Step 2 — Install Lucide React if not already present

Check `package.json`:

```powershell
cd C:\Users\james\PycharmProjects\depo_pro_bolt
type package.json | findstr lucide
```

If you see `"lucide-react"` in dependencies, you're good. If not:

```powershell
npm install lucide-react
```

---

## Step 3 — Create the LayerBadges component

Create `src/components/LayerBadges.tsx`:

```powershell
notepad src\components\LayerBadges.tsx
```

If `src/components/` doesn't exist yet:

```powershell
mkdir src\components
```

Content:

```tsx
import { Lock, Edit, ShieldCheck } from 'lucide-react';

export type Layer = 'raw' | 'working' | 'certified';

interface LayerBadgesProps {
  active: Layer;
}

/**
 * Three layer badges shown in the app header.
 * The currently-active layer is highlighted; the others are dimmed.
 *
 * - Raw is always locked (immutable Deepgram output)
 * - Working is amber when active (editable)
 * - Certified is green when active (locked final)
 */
export function LayerBadges({ active }: LayerBadgesProps) {
  return (
    <div className="flex items-center gap-1.5">
      <Badge
        label="Raw"
        icon={<Lock className="w-3 h-3" />}
        active={active === 'raw'}
        activeClass="bg-slate-700 text-slate-200 border-slate-600"
      />
      <Badge
        label="Working"
        icon={<Edit className="w-3 h-3" />}
        active={active === 'working'}
        activeClass="bg-amber-900/50 text-amber-300 border-amber-700"
      />
      <Badge
        label="Certified"
        icon={<ShieldCheck className="w-3 h-3" />}
        active={active === 'certified'}
        activeClass="bg-emerald-900/50 text-emerald-300 border-emerald-700"
      />
    </div>
  );
}

interface BadgeProps {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  activeClass: string;
}

function Badge({ label, icon, active, activeClass }: BadgeProps) {
  const base =
    'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold border';
  const dim = 'bg-slate-900/50 text-slate-500 border-slate-800';

  return (
    <span className={`${base} ${active ? activeClass : dim}`}>
      {icon}
      {label}
    </span>
  );
}
```

Save and close.

---

## Step 4 — Create the StageProgress component

Create `src/components/StageProgress.tsx`:

```powershell
notepad src\components\StageProgress.tsx
```

Content:

```tsx
import { Check } from 'lucide-react';

export type Stage = 1 | 2 | 3 | 4 | 5;

interface StageProgressProps {
  current: Stage;
  onSelect: (stage: Stage) => void;
  furthestReached: Stage;  // Furthest stage the user has progressed to
}

const STAGES: Array<{ num: Stage; name: string; desc: string }> = [
  { num: 1, name: 'Case Intake', desc: 'NOD & metadata' },
  { num: 2, name: 'Transcribe', desc: 'Audio → Deepgram' },
  { num: 3, name: 'Workspace', desc: 'Edit & verify' },
  { num: 4, name: 'Certification', desc: 'Review & lock' },
  { num: 5, name: 'Export', desc: 'DOCX & deliver' },
];

export function StageProgress({ current, onSelect, furthestReached }: StageProgressProps) {
  return (
    <nav
      className="bg-slate-900/80 border-b border-slate-800 px-6 py-3"
      aria-label="Workflow stages"
    >
      <div className="flex items-center max-w-7xl mx-auto">
        {STAGES.map((stage, idx) => {
          const isCompleted = stage.num < current;
          const isActive = stage.num === current;
          const isReachable = stage.num <= furthestReached;

          return (
            <div key={stage.num} className="flex items-center flex-1">
              <button
                type="button"
                onClick={() => isReachable && onSelect(stage.num)}
                disabled={!isReachable}
                className={`flex items-center gap-2.5 group ${
                  isReachable ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
                }`}
              >
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
                    isCompleted
                      ? 'bg-emerald-500 border-emerald-500 text-slate-950'
                      : isActive
                        ? 'bg-sky-600 border-sky-400 text-white shadow-lg shadow-sky-500/30'
                        : 'bg-slate-900 border-slate-700 text-slate-500'
                  }`}
                >
                  {isCompleted ? <Check className="w-4 h-4" /> : stage.num}
                </div>
                <div className="text-left hidden lg:block">
                  <div
                    className={`text-sm font-semibold leading-tight ${
                      isActive
                        ? 'text-white'
                        : isCompleted
                          ? 'text-slate-300'
                          : 'text-slate-500'
                    }`}
                  >
                    {stage.name}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{stage.desc}</div>
                </div>
              </button>
              {idx < STAGES.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-3 ${
                    isCompleted ? 'bg-emerald-500/50' : 'bg-slate-800'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
```

Save.

---

## Step 5 — Create the Footer component

Create `src/components/Footer.tsx`:

```powershell
notepad src\components\Footer.tsx
```

Content:

```tsx
import { CheckCircle, Lock } from 'lucide-react';

interface FooterProps {
  autosaveStatus?: 'saved' | 'saving' | 'unsaved';
  layerLocked?: boolean;
}

export function Footer({ autosaveStatus = 'saved', layerLocked = false }: FooterProps) {
  return (
    <footer className="bg-slate-900 border-t border-slate-800 px-6 py-2 text-xs text-slate-500 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-3">
        {autosaveStatus === 'saved' && (
          <span className="flex items-center gap-1.5">
            <CheckCircle className="w-3 h-3 text-emerald-500" />
            <span>Autosaved</span>
          </span>
        )}
        {autosaveStatus === 'saving' && (
          <span className="flex items-center gap-1.5 text-amber-400">
            <div className="w-3 h-3 rounded-full bg-amber-400 animate-pulse" />
            <span>Saving...</span>
          </span>
        )}
        <span className="text-slate-700">·</span>
        <span className="flex items-center gap-1.5">
          <Lock className="w-3 h-3 text-slate-600" />
          <span>Raw transcript immutable</span>
        </span>
        <span className="text-slate-700">·</span>
        <span>{layerLocked ? 'Working layer locked' : 'AI may suggest, humans certify'}</span>
      </div>
      <div className="text-slate-600">Depo-Pro v0.1.0</div>
    </footer>
  );
}
```

Save.

---

## Step 6 — Create placeholder components for stages 3, 4, 5

Create `src/stages/WorkspacePlaceholder.tsx`:

```powershell
mkdir src\stages
notepad src\stages\WorkspacePlaceholder.tsx
```

Content:

```tsx
import { Sparkles } from 'lucide-react';

export function WorkspacePlaceholder() {
  return <StagePlaceholder
    title="Transcript Workspace"
    description="The heart of the app. Edit, review AI suggestions, sync with audio, manage formatting — all in one persistent workspace with four modes (Edit, Suggestions, Audio Review, Formatting)."
    phaseName="Phase 4 — Workspace Shell"
  />;
}

export function CertificationPlaceholder() {
  return <StagePlaceholder
    title="Certification"
    description="Pre-lock checklist, reporter signature, insertion page selection. After certification, the working layer is frozen."
    phaseName="Phase 9 — Certification"
  />;
}

export function ExportPlaceholder() {
  return <StagePlaceholder
    title="Export"
    description="Generate the final UFM-compliant Word document. Markdown and HTML previews available. Includes title page, appearances, index, certification, and signature pages as needed."
    phaseName="Phase 10 — Export"
  />;
}

interface StagePlaceholderProps {
  title: string;
  description: string;
  phaseName: string;
}

function StagePlaceholder({ title, description, phaseName }: StagePlaceholderProps) {
  return (
    <div className="flex-1 flex items-center justify-center p-12">
      <div className="max-w-xl text-center space-y-5">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-900 border border-slate-800">
          <Sparkles className="w-8 h-8 text-sky-500" />
        </div>
        <h2 className="text-2xl font-bold text-white">{title}</h2>
        <p className="text-slate-400 leading-relaxed">{description}</p>
        <div className="inline-block bg-slate-900 border border-slate-800 rounded-lg px-4 py-2 text-xs text-slate-500 font-mono">
          Coming in: <span className="text-sky-400">{phaseName}</span>
        </div>
      </div>
    </div>
  );
}
```

Save.

---

## Step 7 — Replace App.tsx

This is the main change. Open `src/App.tsx` and replace its entire contents with the version below.

```powershell
notepad src\App.tsx
```

Select all (Ctrl+A) and delete. Then paste:

```tsx
import { useState, useRef } from 'react';
import SimpleTranscribe from './components/SimpleTranscribe';
import CaseIntakePanel from './components/CaseIntakePanel';
import { LayerBadges, type Layer } from './components/LayerBadges';
import { StageProgress, type Stage } from './components/StageProgress';
import { Footer } from './components/Footer';
import {
  WorkspacePlaceholder,
  CertificationPlaceholder,
  ExportPlaceholder,
} from './stages/WorkspacePlaceholder';

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}

export default function App() {
  // Stage management
  const [stage, setStage] = useState<Stage>(1);
  const [furthestReached, setFurthestReached] = useState<Stage>(1);

  // Layer tracking — set this when stages progress
  const [layer, setLayer] = useState<Layer>('working');

  // Existing toast plumbing
  const [pendingKeyterms, setPendingKeyterms] = useState<string[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastCounter = useRef(0);

  // Case context (will be replaced by real Job in Phase 4)
  const [caseLabel, setCaseLabel] = useState<string>('No case loaded');

  const dismissToast = (id: number) =>
    setToasts((prev) => prev.filter((t) => t.id !== id));

  const _notify = (message: string, type: Toast['type'] = 'success') => {
    const id = ++toastCounter.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => dismissToast(id), type === 'error' ? 14000 : 8000);
  };
  void _notify;

  const advanceStage = (next: Stage) => {
    setStage(next);
    if (next > furthestReached) setFurthestReached(next);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans antialiased">
      {/* Toast stack */}
      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`pointer-events-auto flex items-start gap-3 rounded-xl px-4 py-3.5 shadow-2xl border backdrop-blur-sm ${
                toast.type === 'error'
                  ? 'bg-rose-950/95 border-rose-500/40'
                  : 'bg-slate-900/95 border-slate-700/80'
              }`}
            >
              <div
                className={`mt-0.5 shrink-0 w-4 h-4 rounded-full flex items-center justify-center ${
                  toast.type === 'error' ? 'bg-rose-500' : 'bg-emerald-500'
                }`}
              >
                <svg
                  className="w-2.5 h-2.5 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={3}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d={
                      toast.type === 'error'
                        ? 'M6 18L18 6M6 6l12 12'
                        : 'M5 13l4 4L19 7'
                    }
                  />
                </svg>
              </div>
              <p
                className={`flex-1 text-sm leading-snug font-medium ${
                  toast.type === 'error' ? 'text-rose-100' : 'text-slate-200'
                }`}
              >
                {toast.message}
              </p>
              <button
                onClick={() => dismissToast(toast.id)}
                className={`shrink-0 mt-0.5 transition-colors ${
                  toast.type === 'error'
                    ? 'text-rose-400/60 hover:text-rose-200'
                    : 'text-slate-500 hover:text-slate-200'
                }`}
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* HEADER: logo + case + layer badges */}
      <header className="bg-slate-900/80 backdrop-blur-md border-b border-slate-800/80 px-6 py-3 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center font-bold text-white shadow-lg shadow-sky-600/20 text-sm">
            D
          </div>
          <div>
            <h1 className="text-base font-bold tracking-wide text-white">DEPO-PRO</h1>
            <p className="text-[10px] text-slate-400 font-semibold tracking-wider -mt-0.5 uppercase">
              Deposition Workspace
            </p>
          </div>

          <div className="hidden md:flex items-center gap-2 ml-4 pl-4 border-l border-slate-800">
            <span className="text-xs text-slate-500">Case:</span>
            <span className="text-xs font-semibold text-slate-300 max-w-[260px] truncate">
              {caseLabel}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <LayerBadges active={layer} />
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-950 border border-slate-800/80">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-slate-300 font-medium">Nova 3</span>
          </div>
        </div>
      </header>

      {/* STAGE PROGRESS BAR */}
      <StageProgress
        current={stage}
        onSelect={(s) => setStage(s)}
        furthestReached={furthestReached}
      />

      {/* MAIN: active stage content */}
      <main className="flex-1 overflow-hidden flex flex-col min-h-0">
        {stage === 1 && (
          <CaseIntakePanel
            onKeytermsSaved={(terms) => {
              setPendingKeyterms(terms);
              advanceStage(2);
            }}
          />
        )}
        {stage === 2 && <SimpleTranscribe initialKeyterms={pendingKeyterms} />}
        {stage === 3 && <WorkspacePlaceholder />}
        {stage === 4 && <CertificationPlaceholder />}
        {stage === 5 && <ExportPlaceholder />}
      </main>

      {/* FOOTER */}
      <Footer autosaveStatus="saved" layerLocked={layer === 'certified'} />
    </div>
  );
}
```

Save and close.

---

## Step 8 — Restart the dev server

If `npm run dev` is still running, the change will hot-reload automatically. If not:

```powershell
npm run dev
```

---

## Step 9 — Test in the browser

Open `http://localhost:5173`. You should now see:

- A header with the Depo-Pro logo, case context, and three layer badges (Raw / Working / Certified)
- A five-stage progression bar with stage 1 (Case Intake) active
- The existing Case Intake form below
- A footer with the autosave indicator and "AI may suggest, humans certify" text

Click each stage in the progress bar. Stages 1 and 2 show the existing screens. Stages 3, 4, 5 show the placeholder.

Try clicking stage 4 before reaching stage 2 — it should be disabled (because `furthestReached` is still 1).

When you upload an NOD on stage 1 and click whatever advances the flow, it should auto-advance to stage 2 and unlock it.

---

## Step 10 — Fix anything that looks off

This is iteration time. Some things may need small adjustments:

- **Colors look wrong:** Tailwind classes like `bg-slate-950` require Tailwind to be configured. If colors are missing, check that `tailwind.config.js` has `content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}']`
- **Icons not showing:** Confirm `lucide-react` installed (`npm list lucide-react`)
- **Stage 2 is missing the "advance to stage 3" button:** That's fine for this phase. The existing `SimpleTranscribe` component doesn't know about stage 3 yet. You'll wire that up in Phase 4.

---

## Step 11 — Commit

```powershell
git add src/components/LayerBadges.tsx src/components/StageProgress.tsx src/components/Footer.tsx src/stages/WorkspacePlaceholder.tsx src/App.tsx
git commit -m "Phase 2: visual chrome with 5-stage progression and layer badges"
git push
```

Bolt's GitHub sync picks this up.

---

## Success criterion

All of these are true:

1. The app shows a header with the logo, case context placeholder, and three layer badges
2. Below the header is a 5-stage progression bar
3. Stages 1 and 2 are reachable and show the existing screens
4. Stages 3, 4, 5 are reachable (once Stage 2 is reached) and show "Coming in Phase X" placeholders
5. A persistent footer shows at the bottom with the autosave indicator and the "AI may suggest" message
6. The app still loads at `http://localhost:5173` without errors
7. The change is committed and pushed to GitHub

---

## What's not done yet

The Stage 2 (Transcribe) screen doesn't have a "Continue to Workspace" button. That's intentional for this phase. In Phase 4, when we build the real Workspace, we'll add the wiring to advance from Stage 2 to Stage 3 after a successful transcription.

Also, the `layer` state is hardcoded to `'working'`. Phase 4 will compute it from the Job state in IndexedDB.

The case context label (`caseLabel`) is hardcoded to "No case loaded." Phase 4 will compute it from the active job.

These are all fine. The visual chrome is in place; the wiring follows.

---

## Next

Phase 2 is the last phase in this documentation batch. To continue building, come back to Claude in chat and ask for **the next batch of phases**: Phase 3 (IntakePanel refactor) through Phase 10 (Export).

If you're ready to do work between batches, two things are useful:

1. **Read `30_AI_TOOLS_WORKFLOW.md`** — how to use Bolt, Claude, ChatGPT, and Codex efficiently
2. **Practice running the full stack** with both the frontend dev server and the Python backend in two PowerShell windows

If something breaks, **don't push through it.** Stop, capture the error, and bring it to Claude. Building on top of a broken foundation is the fastest way to lose all the progress you've made.
