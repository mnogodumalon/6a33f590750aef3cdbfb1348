// AUTOMATICALLY GENERATED TYPES - DO NOT EDIT

export type LookupValue = { key: string; label: string };
export type GeoLocation = { lat: number; long: number; info?: string };

export type AttachmentType = 'file' | 'note' | 'url' | 'json';
export interface Attachment {
  id: string;
  type: AttachmentType;
  label: string | null;
  value: string | null;
  active: boolean;
  createdat?: string | null;
  updatedat?: string | null;
}

export interface AttachmentInput {
  type: AttachmentType;
  label?: string;
  value: string;
  active?: boolean;
}

export interface Interessenten {
  record_id: string;
  createdat: string;
  updatedat: string | null;
  fields: {
    vorname?: string;
    nachname?: string;
    email?: string;
    telefon?: string;
    status?: LookupValue;
    objekt?: string; // applookup -> URL zu 'Objekte' Record
  };
}

export interface Objekte {
  record_id: string;
  createdat: string;
  updatedat: string | null;
  fields: {
    titel?: string;
    adresse?: string;
    status?: LookupValue;
    preis?: number;
    fotos?: string;
    beschreibung?: string;
    verfuegbar_ab?: string; // Format: YYYY-MM-DD oder ISO String
  };
}

export interface Besichtigungen {
  record_id: string;
  createdat: string;
  updatedat: string | null;
  fields: {
    titel?: string;
    termin?: string; // Format: YYYY-MM-DD oder ISO String
    objekt?: string; // applookup -> URL zu 'Objekte' Record
    interessent?: string; // applookup -> URL zu 'Interessenten' Record
    notizen?: string;
    fotos?: string;
  };
}

export const APP_IDS = {
  INTERESSENTEN: '6a33f573e1f7f5947e3ad19d',
  OBJEKTE: '6a33f570d897d206f67e2416',
  BESICHTIGUNGEN: '6a33f5740e6503911d335dc6',
} as const;


export const LOOKUP_OPTIONS: Record<string, Record<string, {key: string, label: string}[]>> = {
  'interessenten': {
    status: [{ key: "neu", label: "Neu" }, { key: "kontaktiert", label: "Kontaktiert" }, { key: "besichtigung", label: "Besichtigung" }, { key: "angebot", label: "Angebot" }, { key: "abgesagt", label: "Abgesagt" }],
  },
  'objekte': {
    status: [{ key: "verfuegbar", label: "Verfügbar" }, { key: "reserviert", label: "Reserviert" }, { key: "verkauft", label: "Verkauft" }],
  },
};

export const FIELD_TYPES: Record<string, Record<string, string>> = {
  'interessenten': {
    'vorname': 'string/text',
    'nachname': 'string/text',
    'email': 'string/email',
    'telefon': 'string/tel',
    'status': 'lookup/select',
    'objekt': 'applookup/select',
  },
  'objekte': {
    'titel': 'string/text',
    'adresse': 'string/text',
    'status': 'lookup/select',
    'preis': 'number',
    'fotos': 'file',
    'beschreibung': 'string/textarea',
    'verfuegbar_ab': 'date/date',
  },
  'besichtigungen': {
    'titel': 'string/text',
    'termin': 'date/datetimeminute',
    'objekt': 'applookup/select',
    'interessent': 'applookup/select',
    'notizen': 'string/textarea',
    'fotos': 'file',
  },
};

export const HUB_TOPOLOGY: Record<string, { field: string; entity: string }[]> = {
};

type StripLookup<T> = {
  [K in keyof T]: T[K] extends LookupValue | undefined ? string | LookupValue | undefined
    : T[K] extends LookupValue[] | undefined ? string[] | LookupValue[] | undefined
    : T[K];
};

// Helper Types for creating new records (lookup fields as plain strings for API)
export type CreateInteressenten = StripLookup<Interessenten['fields']>;
export type CreateObjekte = StripLookup<Objekte['fields']>;
export type CreateBesichtigungen = StripLookup<Besichtigungen['fields']>;