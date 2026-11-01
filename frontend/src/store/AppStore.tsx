import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createInitialState, stateFromBootstrap, type AppState } from './state';
import { createServices, type Services } from '@/services';
import { UnauthorizedError } from '@/services/types';
import { setRestaurants } from '@/data/restaurants';
import { config } from '@/config';

type Updater = Partial<AppState> | ((s: AppState) => Partial<AppState>);

export interface StoreApi {
  get: () => AppState;
  set: (u: Updater) => void;
}

interface StoreContextValue extends Services {
  state: AppState;
  store: StoreApi;
  toast: (message: string) => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(createInitialState);
  const [services, setServices] = useState<Services | null>(null);
  const [restoring, setRestoring] = useState(true);

  // A ref mirror so async agent code always reads the latest state.
  const ref = useRef(state);
  ref.current = state;

  const store = useMemo<StoreApi>(
    () => ({
      get: () => ref.current,
      set: (u) => {
        const patch = typeof u === 'function' ? u(ref.current) : u;
        ref.current = { ...ref.current, ...patch };
        setState(ref.current);
      },
    }),
    [],
  );

  const loadSession = useCallback(
    async (api: Services['api']) => {
      const b = await api.bootstrap();
      setRestaurants(b.restaurants);
      store.set(stateFromBootstrap(b));
    },
    [store],
  );

  // Pick real vs mock services, then try to restore an existing session.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = await createServices(store);
      if (cancelled) return;
      setServices(s);
      try {
        await loadSession(s.api);
      } catch (err) {
        if (!(err instanceof UnauthorizedError)) console.warn('[seated] session restore failed', err);
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store, loadSession]);

  const toastTimer = useRef<number | undefined>(undefined);
  const toast = useCallback(
    (message: string) => {
      store.set({ toast: message });
      window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => store.set({ toast: '' }), 2600);
    },
    [store],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      if (!services) return;
      await services.api.login(email, password);
      await loadSession(services.api);
    },
    [services, loadSession],
  );

  const logout = useCallback(async () => {
    await services?.api.logout().catch(() => undefined);
    store.set(createInitialState());
  }, [services, store]);

  const value = useMemo(
    () => (services ? { ...services, state, store, toast, login, logout } : null),
    [services, state, store, toast, login, logout],
  );

  if (!value || restoring) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        Loading Seated{config.useMocks ? ' (mock data)' : ''}…
      </div>
    );
  }
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useApp(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useApp must be used inside AppStoreProvider');
  return ctx;
}
