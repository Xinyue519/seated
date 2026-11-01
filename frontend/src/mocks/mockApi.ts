import type { SeatedApi } from '@/services/types';
import { UnauthorizedError } from '@/services/types';
import { findRestaurant } from '@/data/restaurants';
import { sleep } from '@/lib/dates';
import { getSlots } from './provider';
import { createMockBootstrap } from './seed';

/**
 * In-memory stand-in for the Go API. User data (saved, preferences, …) lives
 * in the app store in mock mode, so the write methods only simulate latency.
 */
export function createMockApi(): SeatedApi {
  let sessionEmail: string | null = null;
  const latency = () => sleep(120 + Math.random() * 180);

  return {
    async login(email) {
      await latency();
      sessionEmail = email; // any email/password works
    },
    async logout() {
      sessionEmail = null;
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
  };
}
