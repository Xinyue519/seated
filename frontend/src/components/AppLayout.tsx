import { Link, NavLink, Outlet } from 'react-router-dom';
import { useApp } from '@/store/AppStore';
import { config } from '@/config';
import { cx } from '@/lib/format';
import Logo from './Logo';
import Toast from './Toast';

const NAV = [
  { to: '/', label: 'Explore', end: true },
  { to: '/saved', label: 'Saved' },
  { to: '/reservations', label: 'Reservations' },
];

export default function AppLayout() {
  const { state, store } = useApp();
  return (
    <div className="flex min-h-screen flex-col md:h-screen">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-4 border-b border-line bg-white px-5">
        <div className="flex flex-wrap items-center gap-7">
          <Link to="/" aria-label="Seated home" className="px-1 py-1.5" onClick={() => store.set({ selectedId: null })}>
            <Logo />
          </Link>
          <nav aria-label="Main" className="flex gap-1">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cx('rounded-lg px-3 py-2 font-medium', isActive ? 'bg-chip text-ink' : 'text-muted hover:text-ink')
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2.5">
          {config.useMocks && (
            <span className="rounded-md border border-dashed border-[#B9B5AB] px-2 py-0.5 text-xs text-muted">Mock data</span>
          )}
          <NavLink
            to="/settings"
            aria-label="Settings"
            className={({ isActive }) =>
              cx(
                'flex h-9 w-9 items-center justify-center rounded-full bg-avatar text-[13px] font-semibold',
                isActive && 'ring-2 ring-ink',
              )
            }
          >
            {(state.user.name || 'S').charAt(0).toUpperCase()}
          </NavLink>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </div>
      <Toast />
    </div>
  );
}
