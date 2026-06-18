import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichInteressenten, enrichBesichtigungen } from '@/lib/enrich';
import type { EnrichedInteressenten, EnrichedBesichtigungen } from '@/types/enriched';
import type { Objekte } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, extractRecordId, createRecordUrl } from '@/services/livingAppsService';
import { formatCurrency, formatDate, formatDateTime, lookupKey } from '@/lib/formatters';
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { format, parseISO, isToday, isBefore, startOfDay, addDays } from 'date-fns';
import { de } from 'date-fns/locale';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  IconAlertCircle, IconTool, IconRefresh, IconCheck,
  IconHome, IconUsers, IconCalendar, IconEye,
  IconPlus, IconBuildingEstate, IconPhone, IconCurrencyEuro,
  IconMapPin, IconPhoto, IconClipboard,
} from '@tabler/icons-react';
import { StatCard, StatCardRow } from '@/components/StatCard';
import { WorkList } from '@/components/WorkList';
import { HeroBanner } from '@/components/HeroBanner';
import { DashboardGrid } from '@/components/DashboardGrid';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import {
  CalendarWidget,
  type CalendarEvent,
} from '@/components/widgets/CalendarWidget';
import {
  KanbanWidget,
  type KanbanCard,
  type KanbanColumn,
} from '@/components/widgets/KanbanWidget';
import {
  RecordOverlay,
  RecordHeader,
  RecordSection,
  RecordField,
  RecordRelation,
  RecordAttachments,
  useRecordOverlayStack,
} from '@/components/widgets/RecordView';
import {
  MediaThumbnail,
  MediaLightbox,
  useMediaViewer,
} from '@/components/widgets/MediaViewer';
import { ObjekteDialog } from '@/components/dialogs/ObjekteDialog';
import { InteressentenDialog } from '@/components/dialogs/InteressentenDialog';
import { BesichtigungenDialog } from '@/components/dialogs/BesichtigungenDialog';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';

const APPGROUP_ID = '6a33f590750aef3cdbfb1348';
const REPAIR_ENDPOINT = '/claude/build/repair';

// ── Leaflet marker icon fix (Vite doesn't bundle default asset URLs) ─────────
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;

function createPinIcon(color: string) {
  return L.divIcon({
    html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="28" height="40">
      <path fill="${color}" stroke="white" stroke-width="1.5"
        d="M12 1C7.03 1 3 5.03 3 10c0 6.6 9 23 9 23S21 16.6 21 10c0-4.97-4.03-9-9-9z"/>
      <circle fill="white" cx="12" cy="10" r="3.5"/>
    </svg>`,
    className: '',
    iconSize: [28, 40],
    iconAnchor: [14, 40],
    popupAnchor: [0, -40],
  });
}

function statusPinColor(key: string | undefined) {
  if (key === 'verfuegbar') return '#16a34a';
  if (key === 'reserviert') return '#d97706';
  return '#6b7280';
}

// ── Geocoding via Nominatim (free, no API key, rate-limited to 1 req/s) ──────
const GEOCODE_CACHE = new Map<string, [number, number] | null>();

async function geocodeAddress(addr: string): Promise<[number, number] | null> {
  if (GEOCODE_CACHE.has(addr)) return GEOCODE_CACHE.get(addr) ?? null;
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(addr)}`,
      { headers: { 'Accept-Language': 'de', 'User-Agent': 'LivingApps-Immobilien/1.0' } }
    );
    if (!r.ok) return null; // z.B. 429 Rate-Limit — nicht cachen, damit Retry möglich
    const data = await r.json();
    const result: [number, number] | null = data[0]
      ? [parseFloat(data[0].lat), parseFloat(data[0].lon)]
      : null;
    GEOCODE_CACHE.set(addr, result);
    return result;
  } catch {
    return null; // Parse-Fehler nicht cachen → Retry beim nächsten Aufruf
  }
}

// ── FitBounds: passt die Kartenansicht an alle Marker an ─────────────────────
function MapFitBounds({ coords }: { coords: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (coords.length === 0) return;
    if (coords.length === 1) { map.setView(coords[0], 15); return; }
    map.fitBounds(coords as L.LatLngBoundsExpression, { padding: [48, 48], maxZoom: 16 });
  }, [map, coords.map(c => c.join(',')).join('|')]);
  return null;
}

// ── Kanban columns for Interessenten pipeline ────────────────────────────────
const INTERESSENTEN_COLUMNS: KanbanColumn[] = (
  LOOKUP_OPTIONS['interessenten']?.['status'] ?? []
).map(o => ({
  key: o.key,
  label: o.label,
  tone:
    o.key === 'angebot' ? 'success' :
    o.key === 'besichtigung' ? 'primary' :
    o.key === 'abgesagt' ? 'destructive' :
    o.key === 'neu' ? 'warning' :
    'default',
}));

// ── Objekte status helpers ───────────────────────────────────────────────────
function objektStatusTone(key: string | undefined) {
  if (key === 'verfuegbar') return 'success' as const;
  if (key === 'reserviert') return 'warning' as const;
  if (key === 'verkauft') return 'default' as const;
  return 'default' as const;
}

// ── Overlay item union ───────────────────────────────────────────────────────
type OverlayItem =
  | { type: 'objekt'; id: string }
  | { type: 'interessent'; id: string }
  | { type: 'besichtigung'; id: string };

export default function DashboardOverview() {
  const {
    interessenten, setInteressenten, objekte, besichtigungen, setBesichtigungen,
    interessentenMap, objekteMap,
    loading, error, fetchAll,
  } = useDashboardData();

  const clock = useClock();

  const enrichedInteressenten = useMemo(
    () => enrichInteressenten(interessenten, { objekteMap }),
    [interessenten, objekteMap]
  );
  const enrichedBesichtigungen = useMemo(
    () => enrichBesichtigungen(besichtigungen, { objekteMap, interessentenMap }),
    [besichtigungen, objekteMap, interessentenMap]
  );

  // ── UI state ─────────────────────────────────────────────────────────────
  const [kpiFilter, setKpiFilter] = useState<'verfuegbar' | 'neu' | 'heute' | null>(null);
  const [objektDialog, setObjektDialog] = useState(false);
  const [editObjekt, setEditObjekt] = useState<Objekte | null>(null);
  const [interessentDialog, setInteressentDialog] = useState(false);
  const [interessentDialogStatus, setInteressentDialogStatus] = useState<string | undefined>();
  const [editInteressent, setEditInteressent] = useState<EnrichedInteressenten | null>(null);
  const [besichtigungDialog, setBesichtigungDialog] = useState(false);
  const [besichtigungDialogDefaults, setBesichtigungDialogDefaults] = useState<Record<string, unknown>>({});
  const [editBesichtigung, setEditBesichtigung] = useState<EnrichedBesichtigungen | null>(null);

  const overlay = useRecordOverlayStack<OverlayItem>();
  const mediaViewer = useMediaViewer();

  // Discard-Bestätigung für ObjekteDialog (Edit-Modus)
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const objektDialogDirtyRef = useRef(false);
  const objektDialogSavedRef = useRef(false);

  // ── Derived data ──────────────────────────────────────────────────────────
  const todayKey = format(clock, 'yyyy-MM-dd');

  const verfuegbareObjekte = useMemo(
    () => objekte.filter(o => lookupKey(o.fields.status) === 'verfuegbar'),
    [objekte]
  );
  const neueInteressenten = useMemo(
    () => enrichedInteressenten.filter(i => lookupKey(i.fields.status) === 'neu'),
    [enrichedInteressenten]
  );
  const heuteBesichtigungen = useMemo(
    () => enrichedBesichtigungen.filter(b => {
      if (!b.fields.termin) return false;
      return b.fields.termin.slice(0, 10) === todayKey;
    }),
    [enrichedBesichtigungen, todayKey]
  );
  const naechsteBesichtigung = useMemo(
    () => enrichedBesichtigungen
      .filter(b => b.fields.termin && b.fields.termin.slice(0, 10) >= todayKey)
      .sort((a, b) => (a.fields.termin ?? '').localeCompare(b.fields.termin ?? ''))[0],
    [enrichedBesichtigungen, todayKey]
  );

  // Hero: Interessenten im "angebot"-Status ohne abschließende Aktivität
  const offeneAngebote = useMemo(
    () => enrichedInteressenten.filter(i => lookupKey(i.fields.status) === 'angebot'),
    [enrichedInteressenten]
  );

  // ── Context line ──────────────────────────────────────────────────────────
  const contextLine = useMemo(() => {
    if (heuteBesichtigungen.length > 0) {
      const names = namen(heuteBesichtigungen.map(b => b.interessentName || b.objektName || 'Besichtigung'));
      return `Heute ${heuteBesichtigungen.length} Besichtigung${heuteBesichtigungen.length > 1 ? 'en' : ''} — ${names}.`;
    }
    if (offeneAngebote.length > 0) {
      const names = namen(offeneAngebote.map(i => [i.fields.vorname, i.fields.nachname].filter(Boolean).join(' ')));
      return `${offeneAngebote.length} Angebot${offeneAngebote.length > 1 ? 'e' : ''} offen — ${names} warten auf Rückmeldung.`;
    }
    if (verfuegbareObjekte.length > 0) {
      return `${verfuegbareObjekte.length} Objekt${verfuegbareObjekte.length > 1 ? 'e' : ''} verfügbar — bereit zur Vermarktung.`;
    }
    return 'Alle Objekte im Blick. Lege dein erstes Objekt an.';
  }, [heuteBesichtigungen, offeneAngebote, verfuegbareObjekte]);

  // ── Calendar events ───────────────────────────────────────────────────────
  const calendarEvents = useMemo<CalendarEvent[]>(() =>
    enrichedBesichtigungen
      .filter(b => !!b.fields.termin)
      .map(b => ({
        id: b.record_id,
        start: b.fields.termin!.slice(0, 16),
        title: b.objektName || b.fields.titel || 'Besichtigung',
        subtitle: b.interessentName || undefined,
        tone:
          b.fields.termin!.slice(0, 10) === todayKey ? 'primary' :
          b.fields.termin!.slice(0, 10) < todayKey ? 'default' :
          'success',
      })),
    [enrichedBesichtigungen, todayKey]
  );

  // ── Interessenten Kanban cards ────────────────────────────────────────────
  const kanbanCards = useMemo<KanbanCard[]>(() =>
    enrichedInteressenten.map(i => ({
      id: `int:${i.record_id}`,
      column: lookupKey(i.fields.status) ?? '',
      title: [i.fields.vorname, i.fields.nachname].filter(Boolean).join(' ') || '(Kein Name)',
      subtitle: i.objektName
        ? <span className="text-xs text-muted-foreground truncate">{i.objektName}</span>
        : undefined,
      tone:
        lookupKey(i.fields.status) === 'angebot' ? 'success' :
        lookupKey(i.fields.status) === 'besichtigung' ? 'primary' :
        lookupKey(i.fields.status) === 'abgesagt' ? 'destructive' :
        lookupKey(i.fields.status) === 'neu' ? 'warning' :
        'default',
    })),
    [enrichedInteressenten]
  );

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleInteressentMove = useCallback(async (cardId: string, newColumn: string) => {
    const id = cardId.split(':')[1] ?? '';
    const prev = interessenten.find(i => i.record_id === id);
    if (!prev) return;
    const snapshot = [...interessenten];
    setInteressenten(interessenten.map(i =>
      i.record_id === id
        ? { ...i, fields: { ...i.fields, status: LOOKUP_OPTIONS['interessenten']?.['status']?.find(o => o.key === newColumn) ?? { key: newColumn, label: newColumn } } }
        : i
    ));
    undoToast(
      `Status auf "${newColumn}" gesetzt`,
      () => {
        setInteressenten(snapshot);
        LivingAppsService.updateInteressentenEntry(id, { status: lookupKey(prev.fields.status) }).catch(() => fetchAll());
      }
    );
    LivingAppsService.updateInteressentenEntry(id, { status: newColumn }).catch(() => {
      setInteressenten(snapshot);
      fetchAll();
    });
  }, [interessenten, setInteressenten, fetchAll]);

  const handleEventDrop = useCallback(async (eventId: string, newStart: string) => {
    const b = besichtigungen.find(x => x.record_id === eventId);
    if (!b) return;
    const snapshot = [...besichtigungen];
    setBesichtigungen(besichtigungen.map(x =>
      x.record_id === eventId ? { ...x, fields: { ...x.fields, termin: newStart.slice(0, 16) } } : x
    ));
    undoToast(
      `Besichtigung auf ${formatDateTime(newStart)} verschoben`,
      () => {
        setBesichtigungen(snapshot);
        LivingAppsService.updateBesichtigungenEntry(eventId, { termin: b.fields.termin }).catch(() => fetchAll());
      }
    );
    LivingAppsService.updateBesichtigungenEntry(eventId, { termin: newStart.slice(0, 16) }).catch(() => {
      setBesichtigungen(snapshot);
      fetchAll();
    });
  }, [besichtigungen, setBesichtigungen, fetchAll]);

  const handleRangeCreate = useCallback((start: Date, _end: Date) => {
    const startStr = format(start, "yyyy-MM-dd'T'HH:mm");
    setBesichtigungDialogDefaults({ termin: startStr });
    setBesichtigungDialog(true);
  }, []);

  // ObjekteDialog-Close mit Discard-Bestätigung
  const handleObjektDialogClose = useCallback(() => {
    if (objektDialogSavedRef.current) {
      objektDialogSavedRef.current = false;
      objektDialogDirtyRef.current = false;
      setObjektDialog(false);
      setEditObjekt(null);
      return;
    }
    if (objektDialogDirtyRef.current) {
      setDiscardConfirmOpen(true);
      return;
    }
    objektDialogDirtyRef.current = false;
    setObjektDialog(false);
    setEditObjekt(null);
  }, []);

  const handleObjektDialogSubmit = useCallback(async (fields: Objekte['fields']) => {
    objektDialogSavedRef.current = true;
    if (editObjekt) {
      await LivingAppsService.updateObjekteEntry(editObjekt.record_id, fields);
    } else {
      await LivingAppsService.createObjekteEntry(fields);
    }
    fetchAll();
  }, [editObjekt, fetchAll]);

  // ── WorkList items for today / upcoming ───────────────────────────────────
  const worklistItems = useMemo(() => {
    const items = heuteBesichtigungen.length > 0 ? heuteBesichtigungen : enrichedBesichtigungen
      .filter(b => b.fields.termin && b.fields.termin.slice(0, 10) >= todayKey)
      .sort((a, b) => (a.fields.termin ?? '').localeCompare(b.fields.termin ?? ''))
      .slice(0, 5);
    return items.map(b => ({
      id: b.record_id,
      title: b.interessentName || '(Kein Interessent)',
      secondLine: (
        <span className="text-xs">
          <span className="text-muted-foreground">{b.objektName || '—'}</span>
          {b.fields.termin && (
            <span className="text-muted-foreground"> · {formatDateTime(b.fields.termin)}</span>
          )}
        </span>
      ),
      icon: <IconEye size={14} className="shrink-0 text-muted-foreground" />,
      action: {
        label: 'Details',
        onClick: () => overlay.replace({ type: 'besichtigung', id: b.record_id }),
      },
    }));
  }, [heuteBesichtigungen, enrichedBesichtigungen, todayKey, overlay]);

  // ── Objekte WorkList ──────────────────────────────────────────────────────
  const objekteWorklistItems = useMemo(() => {
    const filtered = kpiFilter === 'verfuegbar'
      ? verfuegbareObjekte
      : objekte.slice(0, 6);
    return filtered.map(o => ({
      id: o.record_id,
      title: o.fields.titel || '(Kein Titel)',
      secondLine: (
        <span className="text-xs">
          <span className={
            lookupKey(o.fields.status) === 'verfuegbar' ? 'text-green-600 font-medium' :
            lookupKey(o.fields.status) === 'reserviert' ? 'text-amber-600 font-medium' :
            'text-muted-foreground'
          }>
            {o.fields.status?.label ?? '—'}
          </span>
          {o.fields.preis != null && (
            <span className="text-muted-foreground"> · {formatCurrency(o.fields.preis)}</span>
          )}
        </span>
      ),
      icon: <IconHome size={14} className="shrink-0 text-muted-foreground" />,
      action: {
        label: 'Öffnen',
        onClick: () => overlay.replace({ type: 'objekt', id: o.record_id }),
      },
    }));
  }, [kpiFilter, verfuegbareObjekte, objekte, overlay]);

  // ── Overlay: current item ────────────────────────────────────────────────
  const overlayItem = overlay.top;

  const overlayObjekt = overlayItem?.type === 'objekt'
    ? objekte.find(o => o.record_id === overlayItem.id) ?? null
    : null;
  const overlayInteressent = overlayItem?.type === 'interessent'
    ? enrichedInteressenten.find(i => i.record_id === overlayItem.id) ?? null
    : null;
  const overlayBesichtigung = overlayItem?.type === 'besichtigung'
    ? enrichedBesichtigungen.find(b => b.record_id === overlayItem.id) ?? null
    : null;

  // Satellites for objekt overlay
  const objektInteressenten = useMemo(() =>
    overlayObjekt
      ? enrichedInteressenten.filter(i => extractRecordId(i.fields.objekt) === overlayObjekt.record_id)
      : [],
    [overlayObjekt, enrichedInteressenten]
  );
  const objektBesichtigungen = useMemo(() =>
    overlayObjekt
      ? enrichedBesichtigungen.filter(b => extractRecordId(b.fields.objekt) === overlayObjekt.record_id)
      : [],
    [overlayObjekt, enrichedBesichtigungen]
  );

  // ── Loading / Error ───────────────────────────────────────────────────────
  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;

  // ── Empty state ───────────────────────────────────────────────────────────
  const isEmpty = objekte.length === 0 && interessenten.length === 0 && besichtigungen.length === 0;

  if (isEmpty) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{gruss(clock)}</h1>
          <p className="text-muted-foreground text-sm mt-1">Richte dein Vermarktungs-Cockpit ein.</p>
        </div>
        <div className="flex flex-col items-center justify-center py-20 gap-4 rounded-[27px] bg-card shadow-lg">
          <IconBuildingEstate size={48} className="text-muted-foreground" stroke={1.5} />
          <div className="text-center">
            <h3 className="font-semibold text-foreground mb-1">Noch keine Objekte erfasst</h3>
            <p className="text-sm text-muted-foreground max-w-xs">
              Lege dein erstes Immobilienobjekt an und starte die Vermarktung.
            </p>
          </div>
          <Button onClick={() => setObjektDialog(true)}>
            <IconPlus size={16} className="mr-1.5" />
            Erstes Objekt anlegen
          </Button>
        </div>
        <ObjekteDialog
          open={objektDialog}
          onClose={() => setObjektDialog(false)}
          onSubmit={async (fields) => { await LivingAppsService.createObjekteEntry(fields); fetchAll(); }}
          enablePhotoScan={AI_PHOTO_SCAN['Objekte']}
          enablePhotoLocation={AI_PHOTO_LOCATION['Objekte']}
        />
      </div>
    );
  }

  // ── Hero ──────────────────────────────────────────────────────────────────
  const heroOffene = offeneAngebote.slice(0, 3);
  const heroNames = namen(heroOffene.map(i => [i.fields.vorname, i.fields.nachname].filter(Boolean).join(' ')));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{gruss(clock)}</h1>
          <p className="text-muted-foreground text-sm mt-1 truncate">{contextLine}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => { objektDialogDirtyRef.current = false; objektDialogSavedRef.current = false; setObjektDialog(true); }}>
            <IconPlus size={14} className="mr-1.5 shrink-0" />
            <span className="hidden sm:inline">Objekt</span>
            <span className="sm:hidden">Objekt</span>
          </Button>
          <Button size="sm" onClick={() => setBesichtigungDialog(true)}>
            <IconCalendar size={14} className="mr-1.5 shrink-0" />
            <span>Besichtigung</span>
          </Button>
        </div>
      </div>

      <DashboardGrid
        hero={offeneAngebote.length > 0 ? (
          <HeroBanner
            tone="warning"
            icon={<IconPhone size={18} />}
            action={{
              label: 'Angebot nachfassen',
              onClick: () => {
                if (offeneAngebote[0]) overlay.replace({ type: 'interessent', id: offeneAngebote[0].record_id });
              },
            }}
          >
            <b>{heroNames}</b> {offeneAngebote.length === 1 ? 'hat' : 'haben'} ein offenes Angebot —{' '}
            bitte Rückmeldung einholen.
          </HeroBanner>
        ) : undefined}

        kpis={
          <StatCardRow>
            <StatCard
              title="Verfügbare Objekte"
              value={verfuegbareObjekte.length}
              description={verfuegbareObjekte.length === 0 ? 'Alle reserviert oder verkauft' : 'Sofort vermarktbar'}
              icon={<IconHome size={18} className="text-muted-foreground" />}
              tone={verfuegbareObjekte.length > 0 ? 'success' : 'default'}
              onClick={() => setKpiFilter(f => f === 'verfuegbar' ? null : 'verfuegbar')}
              active={kpiFilter === 'verfuegbar'}
            />
            <StatCard
              title="Neue Interessenten"
              value={neueInteressenten.length}
              description={neueInteressenten.length === 0 ? 'Alle kontaktiert' : 'Noch nicht kontaktiert'}
              icon={<IconUsers size={18} className="text-muted-foreground" />}
              tone={neueInteressenten.length > 0 ? 'warning' : 'default'}
              onClick={() => setKpiFilter(f => f === 'neu' ? null : 'neu')}
              active={kpiFilter === 'neu'}
            />
            <StatCard
              title="Besichtigungen heute"
              value={heuteBesichtigungen.length}
              description={
                heuteBesichtigungen.length === 0
                  ? naechsteBesichtigung
                    ? `Nächste: ${formatDate(naechsteBesichtigung.fields.termin)}`
                    : 'Keine geplant'
                  : `${namen(heuteBesichtigungen.map(b => b.interessentName || b.objektName))}`
              }
              icon={<IconCalendar size={18} className="text-muted-foreground" />}
              tone={heuteBesichtigungen.length > 0 ? 'primary' : 'default'}
              onClick={() => setKpiFilter(f => f === 'heute' ? null : 'heute')}
              active={kpiFilter === 'heute'}
            />
          </StatCardRow>
        }

        aside={
          <>
            <WorkList
              title={kpiFilter === 'verfuegbar' ? 'Verfügbare Objekte' : 'Alle Objekte'}
              icon={<IconHome size={14} />}
              items={objekteWorklistItems}
              onItemClick={id => overlay.replace({ type: 'objekt', id })}
              empty={{
                text: 'Noch keine Objekte erfasst',
                action: { label: 'Objekt anlegen', onClick: () => setObjektDialog(true) },
              }}
            />
            <WorkList
              title={heuteBesichtigungen.length > 0 ? 'Besichtigungen heute' : 'Anstehende Besichtigungen'}
              icon={<IconEye size={14} />}
              items={worklistItems}
              onItemClick={id => overlay.replace({ type: 'besichtigung', id })}
              empty={{
                text: naechsteBesichtigung
                  ? `Nächste Besichtigung: ${formatDate(naechsteBesichtigung.fields.termin)} — ${naechsteBesichtigung.interessentName || naechsteBesichtigung.objektName}`
                  : 'Keine Besichtigungen geplant',
                action: { label: 'Termin eintragen', onClick: () => setBesichtigungDialog(true) },
              }}
            />
          </>
        }

        primary={
          <div className="space-y-6">
            {/* Objekte Karte */}
            {objekte.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <IconMapPin size={14} className="shrink-0 text-muted-foreground" />
                  <span className="text-sm font-semibold">
                    Standorte{kpiFilter === 'verfuegbar' ? ' — Verfügbare Objekte' : ''}
                  </span>
                </div>
                <ObjekteMap
                  objekte={kpiFilter === 'verfuegbar' ? verfuegbareObjekte : objekte}
                  onMarkerClick={id => overlay.replace({ type: 'objekt', id })}
                />
              </div>
            )}

            {/* Kalender der Besichtigungen */}
            <CalendarWidget
              events={calendarEvents}
              defaultView="week"
              locale={de}
              dayStartHour={8}
              dayEndHour={20}
              dragSnapMinutes={30}
              onEventClick={ev => overlay.replace({ type: 'besichtigung', id: ev.id })}
              onEventDrop={handleEventDrop}
              onRangeCreate={handleRangeCreate}
              onEmptyClick={(date) => {
                const str = format(date, "yyyy-MM-dd'T'HH:mm");
                setBesichtigungDialogDefaults({ termin: str });
                setBesichtigungDialog(true);
              }}
            />

            {/* Interessenten-Pipeline Kanban */}
            <KanbanWidget
              columns={INTERESSENTEN_COLUMNS}
              cards={kanbanCards}
              defaultCollapsed={['abgesagt']}
              onCardClick={card => {
                const id = card.id.split(':')[1] ?? '';
                overlay.replace({ type: 'interessent', id });
              }}
              onCardMove={handleInteressentMove}
              onAddCard={(column) => {
                setInteressentDialogStatus(column);
                setEditInteressent(null);
                setInteressentDialog(true);
              }}
            />
          </div>
        }
      />

      {/* ── Dialoge ─────────────────────────────────────────────────────── */}
      {/* onChange bubbles from all inputs/textareas inside → dirty detection */}
      <div onChange={() => { objektDialogDirtyRef.current = true; }}>
        <ObjekteDialog
          open={objektDialog || !!editObjekt}
          onClose={handleObjektDialogClose}
          onSubmit={handleObjektDialogSubmit}
          defaultValues={editObjekt?.fields}
          recordId={editObjekt?.record_id}
          enablePhotoScan={AI_PHOTO_SCAN['Objekte']}
          enablePhotoLocation={AI_PHOTO_LOCATION['Objekte']}
        />
      </div>

      {/* Discard-Bestätigung — kommt nach ObjekteDialog → liegt im DOM dahinter und erscheint oben */}
      <DiscardConfirmDialog
        open={discardConfirmOpen}
        onClose={() => setDiscardConfirmOpen(false)}
        onConfirm={() => {
          setDiscardConfirmOpen(false);
          objektDialogDirtyRef.current = false;
          setObjektDialog(false);
          setEditObjekt(null);
        }}
      />

      <InteressentenDialog
        open={interessentDialog || !!editInteressent}
        onClose={() => { setInteressentDialog(false); setEditInteressent(null); setInteressentDialogStatus(undefined); }}
        onSubmit={async (fields) => {
          if (editInteressent) {
            await LivingAppsService.updateInteressentenEntry(editInteressent.record_id, fields);
          } else {
            await LivingAppsService.createInteressentenEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={editInteressent?.fields ?? (interessentDialogStatus ? { status: interessentDialogStatus } : undefined)}
        recordId={editInteressent?.record_id}
        objekteList={objekte}
        enablePhotoScan={AI_PHOTO_SCAN['Interessenten']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Interessenten']}
      />

      <BesichtigungenDialog
        open={besichtigungDialog || !!editBesichtigung}
        onClose={() => { setBesichtigungDialog(false); setEditBesichtigung(null); setBesichtigungDialogDefaults({}); }}
        onSubmit={async (fields) => {
          if (editBesichtigung) {
            await LivingAppsService.updateBesichtigungenEntry(editBesichtigung.record_id, fields);
          } else {
            await LivingAppsService.createBesichtigungenEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={editBesichtigung?.fields ?? (Object.keys(besichtigungDialogDefaults).length > 0 ? besichtigungDialogDefaults as any : undefined)}
        recordId={editBesichtigung?.record_id}
        objekteList={objekte}
        interessentenList={interessenten}
        enablePhotoScan={AI_PHOTO_SCAN['Besichtigungen']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Besichtigungen']}
      />

      {/* ── Overlays ────────────────────────────────────────────────────── */}

      {/* Objekt-Detail-Overlay mit Satelliten */}
      <RecordOverlay
        open={overlay.open && overlayItem?.type === 'objekt'}
        onClose={overlay.close}
        onBack={overlay.canGoBack ? overlay.pop : undefined}
        size="lg"
        onEdit={() => {
          if (overlayObjekt) {
            objektDialogDirtyRef.current = false;
            objektDialogSavedRef.current = false;
            setEditObjekt(overlayObjekt);
            // Dialog öffnet sich ÜBER dem Overlay — kein close()
          }
        }}
        footer={
          overlayObjekt && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (overlayObjekt) {
                    setBesichtigungDialogDefaults({
                      objekt: createRecordUrl(APP_IDS.OBJEKTE, overlayObjekt.record_id),
                    });
                    setBesichtigungDialog(true);
                    overlay.close();
                  }
                }}
              >
                <IconCalendar size={14} className="mr-1.5 shrink-0" />
                Besichtigung anlegen
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (overlayObjekt) {
                    setEditInteressent(null);
                    setInteressentDialogStatus(undefined);
                    setInteressentDialog(true);
                    overlay.close();
                  }
                }}
              >
                <IconPlus size={14} className="mr-1.5 shrink-0" />
                Interessent zuordnen
              </Button>
            </div>
          )
        }
      >
        {overlayObjekt && (
          <div className="xl:grid xl:grid-cols-[1fr_252px] xl:gap-6 xl:items-start">
            {/* Hauptinhalt */}
            <div>
              <RecordHeader
                title={overlayObjekt.fields.titel || '(Kein Titel)'}
                subtitle={overlayObjekt.fields.adresse}
                badges={
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    lookupKey(overlayObjekt.fields.status) === 'verfuegbar' ? 'bg-green-100 text-green-700' :
                    lookupKey(overlayObjekt.fields.status) === 'reserviert' ? 'bg-amber-100 text-amber-700' :
                    'bg-muted text-muted-foreground'
                  }`}>
                    {overlayObjekt.fields.status?.label ?? '—'}
                  </span>
                }
              />
              <RecordSection cols={2}>
                <RecordField label="Preis" value={overlayObjekt.fields.preis} format="currency" />
                <RecordField label="Verfügbar ab" value={overlayObjekt.fields.verfuegbar_ab} format="date" />
                <RecordField label="Adresse" value={overlayObjekt.fields.adresse} />
                <RecordField label="Status" value={overlayObjekt.fields.status?.label} />
              </RecordSection>
              {overlayObjekt.fields.beschreibung && (
                <RecordSection title="Beschreibung">
                  <RecordField label="" value={overlayObjekt.fields.beschreibung} format="longtext" />
                </RecordSection>
              )}
              {/* Besichtigungen */}
              <RecordSection title={`Besichtigungen (${objektBesichtigungen.length})`} icon={IconCalendar}>
                {objektBesichtigungen.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Noch keine Besichtigungen geplant.</p>
                ) : (
                  <div className="space-y-1">
                    {objektBesichtigungen
                      .sort((a, b) => (a.fields.termin ?? '').localeCompare(b.fields.termin ?? ''))
                      .map(b => (
                        <RecordRelation
                          key={b.record_id}
                          name={b.interessentName || b.fields.titel || 'Besichtigung'}
                          meta={formatDateTime(b.fields.termin)}
                          onClick={() => overlay.push({ type: 'besichtigung', id: b.record_id })}
                        />
                      ))}
                  </div>
                )}
              </RecordSection>
              {/* Interessenten — auf kleinen Screens als Sektion, auf xl per rechtem Panel */}
              <div className="xl:hidden">
                <RecordSection title={`Interessenten (${objektInteressenten.length})`} icon={IconUsers}>
                  {objektInteressenten.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Noch keine Interessenten zugeordnet.</p>
                  ) : (
                    <div className="space-y-1">
                      {objektInteressenten.map(i => (
                        <RecordRelation
                          key={i.record_id}
                          name={[i.fields.vorname, i.fields.nachname].filter(Boolean).join(' ') || '(Kein Name)'}
                          meta={i.fields.status?.label}
                          onClick={() => overlay.push({ type: 'interessent', id: i.record_id })}
                        />
                      ))}
                    </div>
                  )}
                </RecordSection>
              </div>
              {/* Fotos */}
              {overlayObjekt.fields.fotos && (
                <RecordSection title="Fotos" icon={IconPhoto}>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <div className="relative aspect-square rounded-lg overflow-hidden">
                      <MediaThumbnail
                        src={overlayObjekt.fields.fotos}
                        alt="Objektfoto"
                        fit="cover"
                        className="w-full h-full"
                        onClick={() => mediaViewer.openWith(
                          [{ url: overlayObjekt.fields.fotos!, title: overlayObjekt.fields.titel || 'Objektfoto' }],
                          0
                        )}
                      />
                    </div>
                  </div>
                </RecordSection>
              )}
              <RecordAttachments appId={APP_IDS.OBJEKTE} recordId={overlayObjekt.record_id} />
            </div>

            {/* Interessenten Schnell-Panel (nur xl) */}
            <div className="hidden xl:block sticky top-0">
              <div className="bg-muted/40 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between pb-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <IconUsers size={14} className="shrink-0 text-muted-foreground" />
                    <span className="font-semibold text-sm truncate">
                      Interessenten ({objektInteressenten.length})
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 shrink-0"
                    onClick={() => {
                      setEditInteressent(null);
                      setInteressentDialogStatus(undefined);
                      setInteressentDialog(true);
                    }}
                    title="Interessent hinzufügen"
                  >
                    <IconPlus size={12} />
                  </Button>
                </div>
                {objektInteressenten.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    Noch keine Interessenten zugeordnet.
                  </p>
                ) : (
                  <div className="space-y-0.5">
                    {objektInteressenten.map(i => (
                      <button
                        key={i.record_id}
                        onClick={() => overlay.push({ type: 'interessent', id: i.record_id })}
                        className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-background/70 transition-colors"
                      >
                        <div className="text-sm font-medium truncate">
                          {[i.fields.vorname, i.fields.nachname].filter(Boolean).join(' ') || '(Kein Name)'}
                        </div>
                        <span className={`text-xs font-medium ${
                          lookupKey(i.fields.status) === 'angebot' ? 'text-green-600' :
                          lookupKey(i.fields.status) === 'abgesagt' ? 'text-red-500' :
                          lookupKey(i.fields.status) === 'besichtigung' ? 'text-blue-600' :
                          lookupKey(i.fields.status) === 'neu' ? 'text-amber-600' :
                          'text-muted-foreground'
                        }`}>
                          {i.fields.status?.label ?? '—'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </RecordOverlay>

      {/* Interessent-Detail-Overlay */}
      <RecordOverlay
        open={overlay.open && overlayItem?.type === 'interessent'}
        onClose={overlay.close}
        onBack={overlay.canGoBack ? overlay.pop : undefined}
        size="md"
        onEdit={() => { if (overlayInteressent) { setEditInteressent(overlayInteressent); overlay.close(); } }}
        footer={
          overlayInteressent && lookupKey(overlayInteressent.fields.status) !== 'abgesagt' && (
            <Button
              size="sm"
              onClick={() => {
                if (!overlayInteressent) return;
                const currentStatus = lookupKey(overlayInteressent.fields.status) ?? 'neu';
                const statusOrder = ['neu', 'kontaktiert', 'besichtigung', 'angebot', 'abgesagt'];
                const nextIdx = statusOrder.indexOf(currentStatus) + 1;
                if (nextIdx >= statusOrder.length) return;
                const nextStatus = statusOrder[nextIdx];
                const snapshot = [...interessenten];
                setInteressenten(interessenten.map(i =>
                  i.record_id === overlayInteressent.record_id
                    ? { ...i, fields: { ...i.fields, status: LOOKUP_OPTIONS['interessenten']?.['status']?.find(o => o.key === nextStatus) ?? { key: nextStatus, label: nextStatus } } }
                    : i
                ));
                undoToast(
                  `Status auf "${nextStatus}" gesetzt`,
                  () => {
                    setInteressenten(snapshot);
                    LivingAppsService.updateInteressentenEntry(overlayInteressent.record_id, { status: currentStatus }).catch(() => fetchAll());
                  }
                );
                LivingAppsService.updateInteressentenEntry(overlayInteressent.record_id, { status: nextStatus }).catch(() => {
                  setInteressenten(snapshot);
                  fetchAll();
                });
                overlay.close();
              }}
            >
              Weiter →
            </Button>
          )
        }
      >
        {overlayInteressent && (
          <>
            <RecordHeader
              title={[overlayInteressent.fields.vorname, overlayInteressent.fields.nachname].filter(Boolean).join(' ') || '(Kein Name)'}
              subtitle={overlayInteressent.objektName || undefined}
              badges={
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  lookupKey(overlayInteressent.fields.status) === 'angebot' ? 'bg-green-100 text-green-700' :
                  lookupKey(overlayInteressent.fields.status) === 'abgesagt' ? 'bg-red-100 text-red-700' :
                  'bg-muted text-muted-foreground'
                }`}>
                  {overlayInteressent.fields.status?.label ?? '—'}
                </span>
              }
            />
            <RecordSection cols={2}>
              <RecordField label="E-Mail" value={overlayInteressent.fields.email} format="email" />
              <RecordField label="Telefon" value={overlayInteressent.fields.telefon} />
              <RecordField label="Status" value={overlayInteressent.fields.status?.label} />
              <RecordField label="Objekt" value={overlayInteressent.objektName || '—'} />
            </RecordSection>
            {/* Besichtigungen des Interessenten */}
            {(() => {
              const intBesichtigungen = enrichedBesichtigungen.filter(
                b => extractRecordId(b.fields.interessent) === overlayInteressent.record_id
              );
              return intBesichtigungen.length > 0 ? (
                <RecordSection title={`Besichtigungen (${intBesichtigungen.length})`} icon={IconCalendar}>
                  <div className="space-y-1">
                    {intBesichtigungen.map(b => (
                      <RecordRelation
                        key={b.record_id}
                        name={b.objektName || b.fields.titel || 'Besichtigung'}
                        meta={formatDateTime(b.fields.termin)}
                        onClick={() => overlay.push({ type: 'besichtigung', id: b.record_id })}
                      />
                    ))}
                  </div>
                </RecordSection>
              ) : null;
            })()}
            <RecordAttachments appId={APP_IDS.INTERESSENTEN} recordId={overlayInteressent.record_id} />
          </>
        )}
      </RecordOverlay>

      {/* Foto-Vollbild-Lightbox */}
      <MediaLightbox
        open={mediaViewer.open}
        items={mediaViewer.items}
        index={mediaViewer.index}
        onClose={mediaViewer.close}
        onIndexChange={mediaViewer.setIndex}
      />

      {/* Besichtigung-Detail-Overlay */}
      <RecordOverlay
        open={overlay.open && overlayItem?.type === 'besichtigung'}
        onClose={overlay.close}
        onBack={overlay.canGoBack ? overlay.pop : undefined}
        size="md"
        onEdit={() => { if (overlayBesichtigung) { setEditBesichtigung(overlayBesichtigung); overlay.close(); } }}
      >
        {overlayBesichtigung && (
          <>
            <RecordHeader
              title={overlayBesichtigung.fields.titel || overlayBesichtigung.objektName || 'Besichtigung'}
              subtitle={overlayBesichtigung.interessentName || undefined}
            />
            <RecordSection cols={2}>
              <RecordField label="Termin" value={overlayBesichtigung.fields.termin} format="datetime" />
              <RecordField label="Objekt" value={overlayBesichtigung.objektName || '—'} />
              <RecordField label="Interessent" value={overlayBesichtigung.interessentName || '—'} />
            </RecordSection>
            {overlayBesichtigung.fields.notizen && (
              <RecordSection title="Notizen" icon={IconClipboard}>
                <RecordField label="" value={overlayBesichtigung.fields.notizen} format="longtext" />
              </RecordSection>
            )}
            {overlayBesichtigung.fields.fotos && (
              <RecordSection title="Fotos" icon={IconPhoto}>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div className="relative aspect-square rounded-lg overflow-hidden">
                    <MediaThumbnail
                      src={overlayBesichtigung.fields.fotos}
                      alt="Besichtigungsfoto"
                      fit="cover"
                      className="w-full h-full"
                      onClick={() => mediaViewer.openWith(
                        [{ url: overlayBesichtigung.fields.fotos!, title: overlayBesichtigung.objektName || 'Besichtigungsfoto' }],
                        0
                      )}
                    />
                  </div>
                </div>
              </RecordSection>
            )}
            {overlayBesichtigung.objektName && (
              <RecordSection>
                <RecordRelation
                  label="Objekt anzeigen"
                  name={overlayBesichtigung.objektName}
                  onClick={() => {
                    const oid = extractRecordId(overlayBesichtigung.fields.objekt);
                    if (oid) overlay.push({ type: 'objekt', id: oid });
                  }}
                />
              </RecordSection>
            )}
            <RecordAttachments appId={APP_IDS.BESICHTIGUNGEN} recordId={overlayBesichtigung.record_id} />
          </>
        )}
      </RecordOverlay>
    </div>
  );
}

// ── ObjekteMap: geocodiert Adressen und zeigt Marker ──────────────────────────
interface ObjekteMapProps {
  objekte: Objekte[];
  onMarkerClick: (id: string) => void;
}

function ObjekteMap({ objekte, onMarkerClick }: ObjekteMapProps) {
  const [coordMap, setCoordMap] = useState<Map<string, [number, number]>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const withAddress = objekte.filter(o => o.fields.adresse);
    const todo = withAddress.filter(o => !GEOCODE_CACHE.has(o.fields.adresse!));

    // Immer zuerst gecachte Koordinaten laden — auch wenn noch neue geocodiert werden
    setCoordMap(prev => {
      const next = new Map(prev);
      let changed = false;
      for (const o of withAddress) {
        const c = GEOCODE_CACHE.get(o.fields.adresse!);
        if (c && !next.has(o.record_id)) { next.set(o.record_id, c); changed = true; }
      }
      return changed ? next : prev;
    });

    if (todo.length === 0) return;

    (async () => {
      for (let i = 0; i < todo.length; i++) {
        if (cancelled) break;
        if (i > 0) await new Promise(r => setTimeout(r, 1200)); // Nominatim: 1 req/s
        const o = todo[i];
        const latlng = await geocodeAddress(o.fields.adresse!);
        if (cancelled || !latlng) continue;
        setCoordMap(prev => new Map(prev).set(o.record_id, latlng));
      }
    })();

    return () => { cancelled = true; };
  }, [objekte.map(o => o.record_id).join(',')]);

  const allCoords = useMemo(() => Array.from(coordMap.values()), [coordMap]);

  const withoutAddress = objekte.filter(o => !o.fields.adresse);
  const geocoding = objekte.filter(o => o.fields.adresse && !coordMap.has(o.record_id)).length > 0;

  return (
    <div className="space-y-1.5">
      <div
        className="rounded-xl overflow-hidden border border-border shadow-sm relative"
        style={{ height: 340, isolation: 'isolate', zIndex: 0 }}
      >
        <MapContainer
          center={allCoords.length > 0 ? allCoords[0] : [51.1657, 10.4515]}
          zoom={allCoords.length === 0 ? 6 : 13}
          style={{ width: '100%', height: '100%' }}
          scrollWheelZoom={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {allCoords.length > 0 && <MapFitBounds coords={allCoords} />}
          {objekte.map(o => {
            const latlng = coordMap.get(o.record_id);
            if (!latlng) return null;
            return (
              <Marker
                key={o.record_id}
                position={latlng}
                icon={createPinIcon(statusPinColor(lookupKey(o.fields.status)))}
                eventHandlers={{ click: () => onMarkerClick(o.record_id) }}
              />
            );
          })}
        </MapContainer>
        {geocoding && (
          <div className="absolute bottom-2 left-2 z-[1000] bg-background/90 backdrop-blur-sm text-xs text-muted-foreground px-2 py-1 rounded-md border border-border pointer-events-none">
            Standorte werden geladen…
          </div>
        )}
      </div>
      {/* Legende */}
      <div className="flex items-center gap-4 px-1 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-green-600 shrink-0" />
          <span className="text-xs text-muted-foreground">Verfügbar</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-600 shrink-0" />
          <span className="text-xs text-muted-foreground">Reserviert</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-gray-500 shrink-0" />
          <span className="text-xs text-muted-foreground">Verkauft</span>
        </div>
        {withoutAddress.length > 0 && (
          <span className="text-xs text-muted-foreground ml-auto">
            {withoutAddress.length} Objekt{withoutAddress.length > 1 ? 'e' : ''} ohne Adresse
          </span>
        )}
      </div>
    </div>
  );
}

function DiscardConfirmDialog({ open, onClose, onConfirm }: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Änderungen verwerfen?</DialogTitle>
          <DialogDescription>
            Deine nicht gespeicherten Änderungen gehen verloren.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>Weiterbearbeiten</Button>
          <Button variant="destructive" onClick={onConfirm}>Verwerfen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
      </div>
      <Skeleton className="h-96 rounded-2xl" />
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}

function DashboardError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const [repairing, setRepairing] = useState(false);
  const [repairStatus, setRepairStatus] = useState('');
  const [repairDone, setRepairDone] = useState(false);
  const [repairFailed, setRepairFailed] = useState(false);

  const handleRepair = async () => {
    setRepairing(true);
    setRepairStatus('Reparatur wird gestartet...');
    setRepairFailed(false);
    const errorContext = JSON.stringify({
      type: 'data_loading',
      message: error.message,
      stack: (error.stack ?? '').split('\n').slice(0, 10).join('\n'),
      url: window.location.href,
    });
    try {
      const resp = await fetch(REPAIR_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ appgroup_id: APPGROUP_ID, error_context: errorContext }),
      });
      if (!resp.ok || !resp.body) { setRepairing(false); setRepairFailed(true); return; }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith('data: ')) continue;
          const content = line.slice(6);
          if (content.startsWith('[STATUS]')) setRepairStatus(content.replace(/^\[STATUS]\s*/, ''));
          if (content.startsWith('[DONE]')) { setRepairDone(true); setRepairing(false); }
          if (content.startsWith('[ERROR]') && !content.includes('Dashboard-Links')) setRepairFailed(true);
        }
      }
    } catch { setRepairing(false); setRepairFailed(true); }
  };

  if (repairDone) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-12 h-12 rounded-2xl bg-green-500/10 flex items-center justify-center">
          <IconCheck size={22} className="text-green-500" />
        </div>
        <div className="text-center">
          <h3 className="font-semibold text-foreground mb-1">Dashboard repariert</h3>
          <p className="text-sm text-muted-foreground max-w-xs">Das Problem wurde behoben. Bitte laden Sie die Seite neu.</p>
        </div>
        <Button size="sm" onClick={() => window.location.reload()}>
          <IconRefresh size={14} className="mr-1" />Neu laden
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <div className="w-12 h-12 rounded-2xl bg-destructive/10 flex items-center justify-center">
        <IconAlertCircle size={22} className="text-destructive" />
      </div>
      <div className="text-center">
        <h3 className="font-semibold text-foreground mb-1">Fehler beim Laden</h3>
        <p className="text-sm text-muted-foreground max-w-xs">
          {repairing ? repairStatus : error.message}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onRetry} disabled={repairing}>Erneut versuchen</Button>
        <Button size="sm" onClick={handleRepair} disabled={repairing}>
          {repairing
            ? <span className="inline-block w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin mr-1" />
            : <IconTool size={14} className="mr-1" />}
          {repairing ? 'Reparatur läuft...' : 'Dashboard reparieren'}
        </Button>
      </div>
      {repairFailed && <p className="text-sm text-destructive">Automatische Reparatur fehlgeschlagen. Bitte kontaktieren Sie den Support.</p>}
    </div>
  );
}
