import type { ReactNode } from 'react';
import { ENTRANCE, entranceDelay } from '@/lib/polish';

/**
 * DashboardGrid — the page skeleton every dashboard composes into.
 *
 * It owns the page PHYSICS so they cannot vary between builds:
 *   · desktop: `lg:grid-cols-3` — primary takes 2/3, aside 1/3; no aside → full width
 *   · mobile order: hero → kpis → aside (work lists first) → primary
 *   · staggered motion-safe entrance: hero 0ms → kpis 120ms → aside 240ms → primary 360ms
 *   · consistent gaps (gap-6 / space-y-6)
 *
 * It owns NOTHING content-related — every slot takes arbitrary nodes:
 *
 *   <DashboardGrid
 *     hero={überfällig.length > 0 && <HeroBanner …>}      // optional — only when urgent
 *     kpis={<StatCardRow>…</StatCardRow>}                  // optional
 *     aside={<><WorkList … /><WorkList … /></>}            // optional — 1–2 surfaces, OWN axis
 *     primary={<KanbanWidget … />}                         // the weight: board/calendar/timeline/table
 *   />
 *
 * The page header (h1 greeting + context line + primary action button) stays
 * ABOVE this component — it is not a slot.
 *
 * Opting out: building the page layout by hand is allowed ONLY for a genuinely
 * different page shape (full-screen map, gallery-first) and costs a written
 * justification comment: `// layout-opt-out: <reason>`.
 */
interface DashboardGridProps {
  /** Alert banner (HeroBanner) — the ONE urgent signal. Render it conditionally;
   *  pass nothing when nothing is urgent (falsy values are fine). */
  hero?: ReactNode;
  /** The KPI line — wrap cards in <StatCardRow>. */
  kpis?: ReactNode;
  /** Secondary surfaces (WorkList, second-entity list, breakdown). They slice a
   *  DIFFERENT axis than `primary` — never the same records re-listed. */
  aside?: ReactNode;
  /** The primary work surface — widget, table↔cards, gallery. */
  primary: ReactNode;
  className?: string;
}

export function DashboardGrid({ hero, kpis, aside, primary, className }: DashboardGridProps) {
  return (
    <div className={`space-y-6 ${className ?? ''}`}>
      {hero ? (
        <div className={ENTRANCE}>{hero}</div>
      ) : null}
      {kpis ? (
        <div className={ENTRANCE} style={entranceDelay(120)}>{kpis}</div>
      ) : null}
      {aside ? (
        <div className="lg:grid lg:grid-cols-3 lg:gap-6 flex flex-col gap-6 lg:flex-none">
          <div className={`order-1 lg:order-2 min-w-0 space-y-6 ${ENTRANCE}`} style={entranceDelay(240)}>
            {aside}
          </div>
          <div className={`order-2 lg:order-1 min-w-0 lg:col-span-2 ${ENTRANCE}`} style={entranceDelay(360)}>
            {primary}
          </div>
        </div>
      ) : (
        <div className={`min-w-0 ${ENTRANCE}`} style={entranceDelay(240)}>{primary}</div>
      )}
    </div>
  );
}
