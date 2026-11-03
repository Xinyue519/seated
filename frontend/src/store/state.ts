import type {
  ChatMessage,
  ConversationContext,
  LastSearch,
  PastVisit,
  PendingBooking,
  Preferences,
  Reservation,
  User,
  Restaurant,
  WorkflowRun,
} from '@/types';
import type { Bootstrap } from '@/services/types';

export interface AppState {
  authed: boolean;
  user: User;
  preferences: Preferences;
  saved: string[];
  visited: string[];
  reservations: Reservation[];
  past: PastVisit[];
  feedback: Record<string, 'up' | 'down'>;
  /** Bumped whenever bookings change, so availability views refetch. */
  availabilityVersion: number;

  messages: ChatMessage[];
  runs: WorkflowRun[];
  busy: boolean;
  busyLabel: string;
  context: ConversationContext;
  pending: PendingBooking | null;
  lastSearch: LastSearch | null;

  /** Restaurant ids the agent wants on the map (null = show everything). */
  mapFilter: string[] | null;
  selectedId: string | null;
  toast: string;
  restaurants: Restaurant[];
}

export function createInitialState(): AppState {
  return {
    authed: false,
    user: { name: '', email: '' },
    preferences: { cuisines: [], priceLevels: [], dietary: [], partySize: 2 },
    saved: [],
    visited: [],
    reservations: [],
    past: [],
    feedback: {},
    availabilityVersion: 0,

    messages: [],
    runs: [],
    busy: false,
    busyLabel: '',
    context: {},
    pending: null,
    lastSearch: null,

    mapFilter: null,
    selectedId: null,
    toast: '',
    restaurants: [],
  };
}

/** State right after a successful login / session restore. */
export function stateFromBootstrap(b: Bootstrap): AppState {
  const firstName = b.user.name.split(' ')[0];
  return {
    ...createInitialState(),
    authed: true,
    user: b.user,
    preferences: b.preferences,
    saved: b.saved,
    visited: b.visited,
    reservations: b.reservations,
    past: b.past,
    restaurants: b.restaurants,
    messages: [
      {
        id: 'welcome',
        role: 'agent',
        text: `Hi${firstName ? ` ${firstName}` : ''}. Tell me what you're in the mood for and I'll find a table and book it. Try a suggestion below, or type your own.`,
      },
    ],
  };
}
