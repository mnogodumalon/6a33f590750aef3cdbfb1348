import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Interessenten, Objekte, Besichtigungen } from '@/types/app';
import { LivingAppsService } from '@/services/livingAppsService';

/** Dashboard data + the OPTIMISTIC-WRITE API.
 *
 *  The per-entity setters (`set<Entity>`) are exported for exactly one job:
 *  optimistic updates on drag writes (onEventDrop / onEventResize /
 *  onCardMove). Call the setter FIRST — the bar/card lands instantly — then
 *  fire the PATCH in the background and call `fetchAll()` ONLY in the catch.
 *  Never await the PATCH before updating state (the UI freezes for the full
 *  round-trip on every drag) and never refetch after a successful write.
 *  There is no other mechanism (no `__optimistic`, no `mutate`).
 */
export function useDashboardData() {
  const [interessenten, setInteressenten] = useState<Interessenten[]>([]);
  const [objekte, setObjekte] = useState<Objekte[]>([]);
  const [besichtigungen, setBesichtigungen] = useState<Besichtigungen[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchAll = useCallback(async () => {
    setError(null);
    try {
      const [interessentenData, objekteData, besichtigungenData] = await Promise.all([
        LivingAppsService.getInteressenten(),
        LivingAppsService.getObjekte(),
        LivingAppsService.getBesichtigungen(),
      ]);
      setInteressenten(interessentenData);
      setObjekte(objekteData);
      setBesichtigungen(besichtigungenData);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Fehler beim Laden der Daten'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Silent background refresh (no loading state change → no flicker)
  useEffect(() => {
    async function silentRefresh() {
      try {
        const [interessentenData, objekteData, besichtigungenData] = await Promise.all([
          LivingAppsService.getInteressenten(),
          LivingAppsService.getObjekte(),
          LivingAppsService.getBesichtigungen(),
        ]);
        setInteressenten(interessentenData);
        setObjekte(objekteData);
        setBesichtigungen(besichtigungenData);
      } catch {
        // silently ignore — stale data is better than no data
      }
    }
    function handleRefresh() { void silentRefresh(); }
    window.addEventListener('dashboard-refresh', handleRefresh);
    return () => window.removeEventListener('dashboard-refresh', handleRefresh);
  }, []);

  const interessentenMap = useMemo(() => {
    const m = new Map<string, Interessenten>();
    interessenten.forEach(r => m.set(r.record_id, r));
    return m;
  }, [interessenten]);

  const objekteMap = useMemo(() => {
    const m = new Map<string, Objekte>();
    objekte.forEach(r => m.set(r.record_id, r));
    return m;
  }, [objekte]);

  return { interessenten, setInteressenten, objekte, setObjekte, besichtigungen, setBesichtigungen, loading, error, fetchAll, interessentenMap, objekteMap };
}