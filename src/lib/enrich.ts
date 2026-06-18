import type { EnrichedBesichtigungen, EnrichedInteressenten } from '@/types/enriched';
import type { Besichtigungen, Interessenten, Objekte } from '@/types/app';
import { extractRecordId } from '@/services/livingAppsService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveDisplay(url: unknown, map: Map<string, any>, ...fields: string[]): string {
  if (!url) return '';
  const id = extractRecordId(url);
  if (!id) return '';
  const r = map.get(id);
  if (!r) return '';
  return fields.map(f => String(r.fields[f] ?? '')).join(' ').trim();
}

interface InteressentenMaps {
  objekteMap: Map<string, Objekte>;
}

export function enrichInteressenten(
  interessenten: Interessenten[],
  maps: InteressentenMaps
): EnrichedInteressenten[] {
  return interessenten.map(r => ({
    ...r,
    objektName: resolveDisplay(r.fields.objekt, maps.objekteMap, 'titel'),
  }));
}

interface BesichtigungenMaps {
  objekteMap: Map<string, Objekte>;
  interessentenMap: Map<string, Interessenten>;
}

export function enrichBesichtigungen(
  besichtigungen: Besichtigungen[],
  maps: BesichtigungenMaps
): EnrichedBesichtigungen[] {
  return besichtigungen.map(r => ({
    ...r,
    objektName: resolveDisplay(r.fields.objekt, maps.objekteMap, 'titel'),
    interessentName: resolveDisplay(r.fields.interessent, maps.interessentenMap, 'vorname', 'nachname'),
  }));
}
