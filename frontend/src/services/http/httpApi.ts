import type { Bootstrap, SeatedApi } from '../types';
import { request } from './client';

/**
 * Go backend implementation. Endpoint paths are the proposed contract;
 * adjust here when the backend routes are finalized.
 */
export const httpApi: SeatedApi = {
  login: (email, password) => request('POST', '/auth/login', { email, password }),
  logout: () => request('POST', '/auth/logout'),
  bootstrap: () => request<Bootstrap>('GET', '/me/bootstrap'),
  getAvailability: async (restaurantId, date) => {
    const res = await request<{ slots: string[] }>(
      'GET',
      `/restaurants/${encodeURIComponent(restaurantId)}/availability?date=${date}`,
    );
    return res.slots;
  },
  setSaved: (restaurantId, saved) =>
    request(saved ? 'PUT' : 'DELETE', `/me/saved/${encodeURIComponent(restaurantId)}`),
  updateProfile: (user) => request('PATCH', '/me', user),
  updatePreferences: (preferences) => request('PUT', '/me/preferences', preferences),
  sendFeedback: (visitId, value) => request('POST', `/me/visits/${encodeURIComponent(visitId)}/feedback`, { value }),
};
