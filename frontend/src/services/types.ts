import type {
  ChatMessage,
  PastVisit,
  Preferences,
  Reservation,
  Restaurant,
  User,
  WorkflowRun,
} from '@/types';

/** Everything the app needs after login. Real: `GET /api/me/bootstrap`. */
export interface Bootstrap {
  user: User;
  preferences: Preferences;
  restaurants: Restaurant[];
  saved: string[];
  visited: string[];
  reservations: Reservation[];
  past: PastVisit[];
}

/** Data API. Implemented by `httpApi` (Go backend) and `mocks/mockApi`. */
export interface SeatedApi {
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  /** Rejects with `UnauthorizedError` when there is no session. */
  bootstrap(): Promise<Bootstrap>;
  getAvailability(restaurantId: string, date: string): Promise<string[]>;
  setSaved(restaurantId: string, saved: boolean): Promise<void>;
  updateProfile(user: User): Promise<void>;
  updatePreferences(preferences: Preferences): Promise<void>;
  sendFeedback(visitId: string, value: 'up' | 'down'): Promise<void>;
  listRestaurants(): Promise<Restaurant[]>;
  upsertRestaurant(restaurant: Restaurant): Promise<void>;
}

/**
 * Agent API. The UI calls these; implementations write messages, workflow
 * runs and reservation changes into the store.
 */
export interface AgentClient {
  send(text: string): Promise<void>;
  pickSlot(restaurantId: string, time: string, date: string): Promise<void>;
  confirm(messageId: string): Promise<void>;
  decline(messageId: string): Promise<void>;
  /** Cancellation approved directly on the Reservations page. */
  cancelReservation(reservationId: string): Promise<void>;
}

/** Shape the backend returns for every agent turn (also used by the mock). */
export interface AgentTurn {
  messages: ChatMessage[];
  runs?: WorkflowRun[];
  /** Restaurant ids to show on the map; `null` clears the filter. */
  mapFilter?: string[] | null;
  reservations?: Reservation[];
}

export class UnauthorizedError extends Error {
  constructor() {
    super('Not signed in');
    this.name = 'UnauthorizedError';
  }
}
