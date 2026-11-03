import type { SeatedApi } from '@/services/types';
import { UnauthorizedError } from '@/services/types';
import { allRestaurants, findRestaurant, setRestaurants } from '@/data/restaurants';
import { sleep } from '@/lib/dates';
import { getSlots } from './provider';
import { createMockBootstrap } from './seed';

const SESSION_KEY = 'seated:mock-session-email';

function readStoredSession(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function writeStoredSession(email: string | null) {
  try {
    if (email) sessionStorage.setItem(SESSION_KEY, email);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore (e.g. storage disabled)
  }
}

/**
 * In-memory stand-in for the Go API. User data (saved, preferences, …) lives
 * in the app store in mock mode, so the write methods only simulate latency.
 * The session email is mirrored to sessionStorage so a page refresh doesn't
 * bounce back to the login screen; closing the tab still ends the session.
 */
export function createMockApi(): SeatedApi {
  let sessionEmail: string | null = readStoredSession();
  const latency = () => sleep(120 + Math.random() * 180);

  return {
    async login(email) {
      await latency();
      sessionEmail = email; // any email/password works
      writeStoredSession(sessionEmail);
    },
    async logout() {
      sessionEmail = null;
      writeStoredSession(null);
    },
    async bootstrap() {
      await latency();
      if (!sessionEmail) throw new UnauthorizedError();
      return createMockBootstrap(sessionEmail);
    },
    async getAvailability(restaurantId, date) {
      await sleep(60);
      const r = findRestaurant(restaurantId);
      return r ? getSlots(r, date) : [];
    },
    setSaved: latency,
    updateProfile: latency,
    updatePreferences: latency,
    sendFeedback: latency,
    async listRestaurants() {
      await latency();
      return allRestaurants();
    },
    async upsertRestaurant(restaurant) {
      await latency();
      const list = allRestaurants();
      if (list.some((r) => r.id === restaurant.id)) return;
      setRestaurants([...list, restaurant]);
    },
  };
}
