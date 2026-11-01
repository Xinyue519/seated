/**
 * Mock backend, loaded only when VITE_USE_MOCKS=true (`npm run start:mock`).
 * Everything under src/mocks is dynamically imported, so it is left out of
 * the real build.
 */
import type { StoreApi } from '@/store/AppStore';
import type { Services } from '@/services';
import { createMockApi } from './mockApi';
import { MockAgent } from './agent/mockAgent';

export function createMockServices(store: StoreApi): Services {
  return { api: createMockApi(), agent: new MockAgent(store) };
}
