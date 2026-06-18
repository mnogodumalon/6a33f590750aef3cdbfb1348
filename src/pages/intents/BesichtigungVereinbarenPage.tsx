import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { IntentWizardShell } from '@/components/IntentWizardShell';
import { EntitySelectStep } from '@/components/EntitySelectStep';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { IconUser, IconBuilding, IconCalendar, IconCheck, IconArrowLeft, IconPlus } from '@tabler/icons-react';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import { APP_IDS } from '@/types/app';
import type { Interessenten, Objekte } from '@/types/app';

const STEPS = [
  { label: 'Interessent' },
  { label: 'Objekt' },
  { label: 'Termin' },
  { label: 'Bestätigung' },
];

export default function BesichtigungVereinbarenPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Data state
  const [interessenten, setInteressenten] = useState<Interessenten[]>([]);
  const [objekte, setObjekte] = useState<Objekte[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Wizard state
  const initialStep = (() => {
    const s = parseInt(searchParams.get('step') ?? '', 10);
    return s >= 1 && s <= 4 ? s : 1;
  })();
  const [currentStep, setCurrentStep] = useState(initialStep);

  // Selections
  const initialInteressentId = searchParams.get('interessentId') ?? null;
  const initialObjektId = searchParams.get('objektId') ?? null;
  const [selectedInteressentId, setSelectedInteressentId] = useState<string | null>(initialInteressentId);
  const [selectedObjektId, setSelectedObjektId] = useState<string | null>(initialObjektId);

  // Step 3 form state
  const [termin, setTermin] = useState('');
  const [titel, setTitel] = useState('');
  const [notizen, setNotizen] = useState('');

  // Step 4 result
  const [createdTermin, setCreatedTermin] = useState('');

  // Fetch data on mount
  useEffect(() => {
    let cancelled = false;
    async function fetchAll() {
      setLoading(true);
      setError(null);
      try {
        const [int, obj] = await Promise.all([
          LivingAppsService.getInteressenten(),
          LivingAppsService.getObjekte(),
        ]);
        if (!cancelled) {
          setInteressenten(int);
          setObjekte(obj);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchAll();
    return () => { cancelled = true; };
  }, []);

  // Pre-fill titel when objekt is selected
  useEffect(() => {
    if (selectedObjektId) {
      const obj = objekte.find(o => o.record_id === selectedObjektId);
      if (obj) {
        setTitel(`Besichtigung: ${obj.fields.titel ?? ''}`);
      }
    }
  }, [selectedObjektId, objekte]);

  const selectedInteressent = interessenten.find(i => i.record_id === selectedInteressentId) ?? null;
  const selectedObjekt = objekte.find(o => o.record_id === selectedObjektId) ?? null;

  const handleSelectInteressent = (id: string) => {
    setSelectedInteressentId(id);
    setCurrentStep(2);
  };

  const handleSelectObjekt = (id: string) => {
    setSelectedObjektId(id);
    setCurrentStep(3);
  };

  const handleSubmit = async () => {
    if (!selectedInteressentId || !selectedObjektId || !termin) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const terminValue = termin.slice(0, 16); // ensure YYYY-MM-DDTHH:MM
      await LivingAppsService.createBesichtigungenEntry({
        titel: titel || `Besichtigung: ${selectedObjekt?.fields.titel ?? ''}`,
        termin: terminValue,
        objekt: createRecordUrl(APP_IDS.OBJEKTE, selectedObjektId),
        interessent: createRecordUrl(APP_IDS.INTERESSENTEN, selectedInteressentId),
        notizen: notizen || undefined,
      });
      setCreatedTermin(terminValue);
      setCurrentStep(4);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Unbekannter Fehler');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setSelectedInteressentId(null);
    setSelectedObjektId(null);
    setTermin('');
    setTitel('');
    setNotizen('');
    setCreatedTermin('');
    setSubmitError(null);
    setCurrentStep(1);
  };

  const formatPreis = (preis?: number) => {
    if (preis == null) return '—';
    return `€ ${preis.toLocaleString('de-DE')}`;
  };

  return (
    <IntentWizardShell
      title="Besichtigung vereinbaren"
      subtitle="Interessent und Objekt auswählen, Termin festlegen"
      steps={STEPS}
      currentStep={currentStep}
      onStepChange={setCurrentStep}
      loading={loading}
      error={error}
      onRetry={() => {
        setLoading(true);
        Promise.all([
          LivingAppsService.getInteressenten(),
          LivingAppsService.getObjekte(),
        ]).then(([int, obj]) => {
          setInteressenten(int);
          setObjekte(obj);
          setError(null);
        }).catch(e => setError(e instanceof Error ? e : new Error(String(e))))
          .finally(() => setLoading(false));
      }}
    >
      {/* Step 1 — Interessent auswählen */}
      {currentStep === 1 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Interessent auswählen</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Wähle den Interessenten aus, für den die Besichtigung geplant werden soll.
            </p>
          </div>
          <EntitySelectStep
            items={interessenten.map(i => ({
              id: i.record_id,
              title: `${i.fields.vorname ?? ''} ${i.fields.nachname ?? ''}`.trim() || '(kein Name)',
              subtitle: i.fields.email ?? i.fields.telefon ?? '',
              status: i.fields.status
                ? { key: i.fields.status.key, label: i.fields.status.label }
                : undefined,
              icon: <IconUser size={20} className="text-primary" />,
            }))}
            onSelect={handleSelectInteressent}
            searchPlaceholder="Interessenten suchen..."
            emptyIcon={<IconUser size={32} />}
            emptyText="Keine Interessenten gefunden."
          />
          {selectedInteressentId && (
            <div className="flex justify-end pt-2">
              <Button onClick={() => setCurrentStep(2)} className="gap-2">
                Weiter
                <IconCheck size={16} />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Step 2 — Objekt auswählen */}
      {currentStep === 2 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Objekt auswählen</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Wähle das Objekt aus, das besichtigt werden soll.
            </p>
          </div>
          {selectedInteressent && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-sm text-muted-foreground">
              <IconUser size={14} className="shrink-0 text-primary" />
              <span>
                Interessent: <span className="font-medium text-foreground">
                  {`${selectedInteressent.fields.vorname ?? ''} ${selectedInteressent.fields.nachname ?? ''}`.trim()}
                </span>
              </span>
            </div>
          )}
          <EntitySelectStep
            items={objekte.map(o => ({
              id: o.record_id,
              title: o.fields.titel ?? '(kein Titel)',
              subtitle: o.fields.adresse ?? '',
              status: o.fields.status
                ? { key: o.fields.status.key, label: o.fields.status.label }
                : undefined,
              stats: [{ label: 'Preis', value: formatPreis(o.fields.preis) }],
              icon: <IconBuilding size={20} className="text-primary" />,
            }))}
            onSelect={handleSelectObjekt}
            searchPlaceholder="Objekte suchen..."
            emptyIcon={<IconBuilding size={32} />}
            emptyText="Keine Objekte gefunden."
          />
          <div className="flex justify-between pt-2">
            <Button variant="outline" onClick={() => setCurrentStep(1)} className="gap-2">
              <IconArrowLeft size={16} />
              Zurück
            </Button>
            {selectedObjektId && (
              <Button onClick={() => setCurrentStep(3)} className="gap-2">
                Weiter
                <IconCheck size={16} />
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Step 3 — Termin & Details */}
      {currentStep === 3 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold">Termin & Details</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Lege den Besichtigungstermin und weitere Details fest.
            </p>
          </div>

          {/* Summary card */}
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Zusammenfassung</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <IconUser size={16} className="text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Interessent</p>
                  <p className="text-sm font-medium truncate">
                    {selectedInteressent
                      ? `${selectedInteressent.fields.vorname ?? ''} ${selectedInteressent.fields.nachname ?? ''}`.trim()
                      : '—'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <IconBuilding size={16} className="text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Objekt</p>
                  <p className="text-sm font-medium truncate">
                    {selectedObjekt?.fields.titel ?? '—'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Form */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor="termin">
                Termin <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <IconCalendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  id="termin"
                  type="datetime-local"
                  value={termin}
                  onChange={e => setTermin(e.target.value)}
                  className="pl-9"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor="titel">
                Titel
              </label>
              <Input
                id="titel"
                type="text"
                value={titel}
                onChange={e => setTitel(e.target.value)}
                placeholder="z.B. Besichtigung: Musterstraße 1"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor="notizen">
                Notizen
              </label>
              <textarea
                id="notizen"
                value={notizen}
                onChange={e => setNotizen(e.target.value)}
                placeholder="Optionale Anmerkungen zur Besichtigung..."
                rows={3}
                className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
              />
            </div>
          </div>

          {submitError && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
              Fehler: {submitError}
            </div>
          )}

          <div className="flex justify-between pt-2">
            <Button variant="outline" onClick={() => setCurrentStep(2)} className="gap-2" disabled={submitting}>
              <IconArrowLeft size={16} />
              Zurück
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!termin || submitting}
              className="gap-2"
            >
              {submitting ? 'Wird angelegt...' : 'Besichtigung anlegen'}
              {!submitting && <IconCalendar size={16} />}
            </Button>
          </div>
        </div>
      )}

      {/* Step 4 — Bestätigung */}
      {currentStep === 4 && (
        <div className="space-y-6">
          <div className="flex flex-col items-center text-center py-6 gap-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <IconCheck size={32} className="text-primary" stroke={2.5} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Besichtigung erfolgreich angelegt</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Die Besichtigung wurde erfolgreich in deinem System gespeichert.
              </p>
            </div>
          </div>

          {/* Summary */}
          <div className="rounded-xl border bg-card p-5 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Details</p>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <IconUser size={16} className="text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Interessent</p>
                  <p className="text-sm font-medium">
                    {selectedInteressent
                      ? `${selectedInteressent.fields.vorname ?? ''} ${selectedInteressent.fields.nachname ?? ''}`.trim()
                      : '—'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <IconBuilding size={16} className="text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Objekt</p>
                  <p className="text-sm font-medium truncate">{selectedObjekt?.fields.titel ?? '—'}</p>
                  {selectedObjekt?.fields.adresse && (
                    <p className="text-xs text-muted-foreground truncate">{selectedObjekt.fields.adresse}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <IconCalendar size={16} className="text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Termin</p>
                  <p className="text-sm font-medium">
                    {createdTermin
                      ? format(parseISO(createdTermin), 'dd.MM.yyyy HH:mm')
                      : '—'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Button variant="outline" onClick={handleReset} className="gap-2 flex-1">
              <IconPlus size={16} />
              Neue Besichtigung
            </Button>
            <a href="#/" className="flex-1">
              <Button variant="default" className="w-full gap-2">
                Zurück zum Dashboard
              </Button>
            </a>
          </div>
        </div>
      )}
    </IntentWizardShell>
  );
}
