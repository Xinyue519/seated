import { config } from '@/config';
import type { StoreApi } from '@/store/AppStore';
import type { AgentClient, SeatedApi } from './types';

export interface Services {
  api: SeatedApi;
  agent: AgentClient;
}

/** Picks the real backend or the mock backend based on VITE_USE_MOCKS. */
export async function createServices(store: StoreApi): Promise<Services> {
  if (config.useMocks) {
    const { createMockServices } = await import('@/mocks');
    return createMockServices(store);
  }
  const [{ httpApi }, { HttpAgent }] = await Promise.all([import('./http/httpApi'), import('./http/httpAgent')]);
  return { api: httpApi, agent: new HttpAgent(store) };
}
