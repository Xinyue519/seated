/**
 * Runtime config from Vite env files:
 *   .env        defaults (real API)
 *   .env.mock   `npm run start:mock` / `npm run build:mock`
 */
export const config = {
  useMocks: import.meta.env.VITE_USE_MOCKS === 'true',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || '/api',
} as const;
