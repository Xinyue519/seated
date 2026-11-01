/**
 * Runtime config from Vite env files:
 *   .env        defaults (real API)
 *   .env.mock   `npm run start:mock` / `npm run build:mock`
 */
export const config = {
  useMocks: import.meta.env.VITE_USE_MOCKS === 'true',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || '/api',
  /** Browser key (public by nature: restrict it by HTTP referrer). Empty → placeholder map. */
  googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
  /** Cloud-styled vector Map ID. Required for advanced markers; DEMO_MAP_ID works unstyled. */
  googleMapId: import.meta.env.VITE_GOOGLE_MAP_ID || 'DEMO_MAP_ID',
} as const;
