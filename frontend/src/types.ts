export type CuisineGroup =
  | 'italian'
  | 'pizza'
  | 'french'
  | 'japanese'
  | 'mexican'
  | 'korean'
  | 'thai'
  | 'deli'
  | 'american'
  | 'vegetarian';

export type PriceLevel = 1 | 2 | 3 | 4;

/** Mirrors the internal restaurant schema in the build plan (subset used by the UI). */
export interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  group: CuisineGroup;
  neighborhood: string;
  priceLevel: PriceLevel;
  lat: number;
  lng: number;
  tags: string[];
  description: string;
  imageUrl?: string;
  vegetarian?: boolean;
  /** Demo flag: never has availability (exercises the no-availability fallback). */
  alwaysFull?: boolean;
  /** Demo flag: first booking attempt fails with SLOT_TAKEN (exercises failure handling). */
  flakyBooking?: boolean;
}

export type ReservationStatus = 'confirmed' | 'cancelled';

export interface Reservation {
  id: string;
  restaurantId: string;
  /** ISO date, YYYY-MM-DD */
  date: string;
  /** 24h-free display time used by the mock provider, e.g. "7:30" (PM) */
  time: string;
  partySize: number;
  status: ReservationStatus;
  bookedBy: 'agent' | 'user';
}

export interface PastVisit {
  id: string;
  restaurantId: string;
  label: string;
  recommended: boolean;
}

export type Dietary = 'vegetarian' | 'vegan' | 'gluten-free' | 'nut-allergy';

export interface Preferences {
  cuisines: CuisineGroup[];
  priceLevels: PriceLevel[];
  dietary: Dietary[];
  partySize: number;
}

export interface User {
  name: string;
  email: string;
}

/* ---------- agent + workflow trace ---------- */

export type StepStatus = 'ok' | 'waiting' | 'failed';

export interface TraceStep {
  name: string;
  status: StepStatus;
  durationMs?: number;
  detail?: string;
}

export type RunStatus = 'running' | 'waiting' | 'done' | 'recovered' | 'stopped';

export interface WorkflowRun {
  id: string;
  workflow: string;
  title: string;
  status: RunStatus;
  steps: TraceStep[];
}

export interface Chip {
  label: string;
  missing?: boolean;
}

export interface ResultItem {
  restaurantId: string;
  reasons: string[];
}

export type ConfirmKind = 'book' | 'modify' | 'cancel';
export type ConfirmState = 'open' | 'working' | 'done' | 'failed' | 'declined';

export interface ConfirmRequest {
  kind: ConfirmKind;
  restaurantId: string;
  date: string;
  time: string;
  partySize: number;
  reservationId?: string;
  runId: string;
  state: ConfirmState;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  text?: string;
  chips?: Chip[];
  toolsSummary?: string;
  toolsTone?: 'ok' | 'warn';
  results?: ResultItem[];
  /** Date the results' slots are for. */
  resultsDate?: string;
  confirm?: ConfirmRequest;
  action?: 'reservations';
  followUp?: string;
}

export type DayWord =
  | 'today'
  | 'tomorrow'
  | 'weekend'
  | 'sunday'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday';

export interface ConversationContext {
  day?: DayWord;
  partySize?: number;
  time?: string;
  neighborhood?: string;
}

export interface PendingBooking {
  restaurantId: string;
  date: string;
  time?: string;
  partySize?: number;
  modifyId?: string;
}

/** Structured entities pulled from a message (what the LLM extraction step will return). */
export interface Entities {
  cuisine?: CuisineGroup;
  neighborhood?: string;
  reference?: Restaurant;
  similar?: boolean;
  excludeSaved?: boolean;
  likeSaved?: boolean;
  onlySaved?: boolean;
  partySize?: number;
  time?: string;
  day?: DayWord;
  maxPrice?: PriceLevel;
  minPrice?: PriceLevel;
  vegetarian?: boolean;
  raw: string;
}

export interface RankedResult {
  restaurantId: string;
  score: number;
  reasons: string[];
}

export interface LastSearch {
  query: Entities;
  ranked: RankedResult[];
  offset: number;
  minShownPrice: PriceLevel;
}
