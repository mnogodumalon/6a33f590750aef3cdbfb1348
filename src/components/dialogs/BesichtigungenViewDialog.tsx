import type { Besichtigungen, Objekte, Interessenten } from '@/types/app';
import { extractRecordId } from '@/services/livingAppsService';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { APP_IDS } from '@/types/app';
import { AttachmentsSection } from '@/components/AttachmentsSection';
import { MediaThumbnail } from '@/components/widgets/MediaViewer';
import { IconPencil, IconFileText } from '@tabler/icons-react';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';

function formatDate(d?: string) {
  if (!d) return '—';
  try { return format(parseISO(d), 'dd.MM.yyyy', { locale: de }); } catch { return d; }
}

interface BesichtigungenViewDialogProps {
  open: boolean;
  onClose: () => void;
  record: Besichtigungen | null;
  onEdit: (record: Besichtigungen) => void;
  objekteList: Objekte[];
  interessentenList: Interessenten[];
}

export function BesichtigungenViewDialog({ open, onClose, record, onEdit, objekteList, interessentenList }: BesichtigungenViewDialogProps) {
  function getObjekteDisplayName(url?: unknown) {
    if (!url) return '—';
    const id = extractRecordId(url);
    return objekteList.find(r => r.record_id === id)?.fields.titel ?? '—';
  }

  function getInteressentenDisplayName(url?: unknown) {
    if (!url) return '—';
    const id = extractRecordId(url);
    return interessentenList.find(r => r.record_id === id)?.fields.vorname ?? '—';
  }

  if (!record) return null;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Besichtigungen anzeigen</DialogTitle>
        </DialogHeader>
        <div className="flex justify-end">
          <Button size="sm" onClick={() => { onClose(); onEdit(record); }}>
            <IconPencil className="h-3.5 w-3.5 mr-1.5" />
            Bearbeiten
          </Button>
        </div>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Titel</Label>
            <p className="text-sm">{record.fields.titel ?? '—'}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Termin</Label>
            <p className="text-sm">{formatDate(record.fields.termin)}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Objekt</Label>
            <p className="text-sm">{getObjekteDisplayName(record.fields.objekt)}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Interessent</Label>
            <p className="text-sm">{getInteressentenDisplayName(record.fields.interessent)}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Notizen</Label>
            <p className="text-sm whitespace-pre-wrap">{record.fields.notizen ?? '—'}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Fotos</Label>
            {record.fields.fotos ? (
              <MediaThumbnail src={record.fields.fotos} fit="contain" className="w-full rounded-lg border" />
            ) : <p className="text-sm text-muted-foreground">—</p>}
          </div>
          <div className="pt-2 border-t border-border">
            <AttachmentsSection appId={APP_IDS.BESICHTIGUNGEN} recordId={record.record_id} readOnly />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}