import type { Besichtigungen, Interessenten } from './app';

export type EnrichedInteressenten = Interessenten & {
  objektName: string;
};

export type EnrichedBesichtigungen = Besichtigungen & {
  objektName: string;
  interessentName: string;
};
