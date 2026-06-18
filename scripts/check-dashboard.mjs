#!/usr/bin/env node
/**
 * check-dashboard.mjs — mechanical pre-build gate for DashboardOverview.tsx.
 *
 * Runs in Step 3 (after parse-formulas.mjs, before `npm run build`). Exits
 * non-zero with actionable messages; fix every ERROR and re-run until green.
 * Text-based on purpose: cheap, deterministic, no AST dependency.
 */
import { readFileSync } from 'node:fs';

const FILE = 'src/pages/DashboardOverview.tsx';
let src;
try {
  src = readFileSync(FILE, 'utf8');
} catch {
  console.error(`ERROR: ${FILE} not found — run from the project root.`);
  process.exit(1);
}

const errors = [];
const warnings = [];

// 1. UTC day-shift trap
if (src.includes('toISOString')) {
  errors.push("toISOString() found — day keys MUST use date-fns format(d, 'yyyy-MM-dd') (toISOString is UTC; the day flips at the wrong hour).");
}

// 2. Page skeleton: DashboardGrid or a written opt-out
if (!src.includes('<DashboardGrid') && !src.includes('layout-opt-out:')) {
  errors.push("Page layout is hand-rolled — compose <DashboardGrid hero/kpis/aside/primary> (it owns grid, mobile order, entrance). A genuinely different page shape needs a `// layout-opt-out: <reason>` comment.");
}

// 3. Polish layer imported
if (!src.includes("from '@/lib/polish'")) {
  errors.push("No import from '@/lib/polish' — the polish layer (useClock, gruss, namen, undoToast) is mandatory, do not re-derive it by hand.");
}

// 4. Drag/status writes need the undo toast
if (/onCardMove|onEventDrop|onEventResize/.test(src) && !src.includes('undoToast(')) {
  errors.push('Drag/status write handlers found but no undoToast(...) — every write gets feedback + Rückgängig (counter-write).');
}

// 5. Record clicks open the overlay
if (/onCardClick|onEventClick/.test(src) && !src.includes('<RecordOverlay')) {
  errors.push('onCardClick/onEventClick wired but no <RecordOverlay> — every record click opens the overlay (RecordView HARD RULE).');
}

// 6. Unguarded parseISO on optional record fields — the sandbox build does NOT
// enforce strictNullChecks, so parseISO(undefined) crashes at RUNTIME
// ("Cannot read properties of undefined (reading 'split')"), taking the whole
// dashboard down for one record with a missing date.
// A parseISO(x.fields.FIELD) is safe when the SAME field is guarded — three
// shapes count, so the natural readable patterns don't trip the gate:
//   · inline on the same line:        x.fields.F ? parseISO(x.fields.F) : …   /  x.fields.F && …  /  x.fields.F!
//   · early-return in the callback:   if (!x.fields.F) return …; … parseISO(x.fields.F)
//   · pre-filter up the chain:        .filter(r => !!r.fields.F) … parseISO(r.fields.F!)
// Only a parseISO with NO guard on its field anywhere nearby is a real crash
// risk (the sandbox build has no strictNullChecks → parseISO(undefined) throws
// at runtime and takes the whole page down).
const dashLines = src.split('\n');
const unguardedParseISO = [];
for (let i = 0; i < dashLines.length; i++) {
  const line = dashLines[i];
  const m = line.match(/parseISO\(\s*[\w$]+\.fields\.(\w+)\s*\)/);
  if (!m) continue;
  const field = m[1];
  // (a) inline guard on the same line (?, !, &&)
  if (/[!?]|&&/.test(line)) continue;
  // (b) a guard on the SAME field within the preceding lines — an early-return
  //     `if (!x.fields.F) …`, a ternary/&&, or a `.filter(… fields.F …)` that
  //     pre-filtered the chain. Require both: the field is referenced AND a
  //     guard token is present, so an unrelated mention doesn't wave it through.
  const back = dashLines.slice(Math.max(0, i - 8), i).join('\n');
  const fieldGuarded =
    new RegExp(`\\.fields\\.${field}\\b`).test(back) && /(!|\?|&&|\breturn\b|\.filter\()/.test(back);
  if (fieldGuarded) continue;
  unguardedParseISO.push(i + 1);
}
for (const n of unguardedParseISO) {
  errors.push(`Line ${n}: parseISO(x.fields.…) without a guard — one record with a missing date crashes the page. Guard inline (r.fields.X ? … : …), early-return (if (!r.fields.X) return …) before the parseISO, or pre-filter the chain (.filter(r => !!r.fields.X)) and assert with r.fields.X!.`);
}

// 7. Frozen clock
if (!src.includes('useClock(')) {
  warnings.push("useClock() not used — if any 'today'/overdue/greeting derivation exists, it must tick (a Date captured once shows yesterday tomorrow).");
}

// 8. Filler totals
if (/(?:title|description)\s*=\s*["'{][^"'}]*[Gg]esamt/.test(src)) {
  warnings.push("A KPI mentions 'gesamt' — bare totals are filler; every KPI is a clickable filter or a progress toward a limit.");
}

// 9. Aside present (or consciously omitted)
if (src.includes('<DashboardGrid') && !/aside\s*=/.test(src)) {
  warnings.push('DashboardGrid without aside — fine ONLY when the app truly has no secondary slice; otherwise add a WorkList on a different axis than the primary widget.');
}

for (const w of warnings) console.log(`WARN: ${w}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`ERROR: ${e}`);
  console.error(`\n${errors.length} error(s) — fix DashboardOverview.tsx and re-run.`);
  process.exit(1);
}
console.log(`check-dashboard: OK (${warnings.length} warning(s))`);
