import { Link, NavLink, Outlet } from 'react-router-dom';
import { useApp } from '@/store/AppStore';
import { config } from '@/config';
import { cx } from '@/lib/format';
import Logo from './Logo';
import Toast from './Toast';
import styles from './components.module.css';

const NAV = [
  { to: '/', label: 'Explore', end: true },
  { to: '/saved', label: 'Saved' },
  { to: '/reservations', label: 'Reservations' },
];

export default function AppLayout() {
  const { state, store } = useApp();
  return (
    <div className={styles.layoutRoot}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Link to="/" aria-label="Seated home" className={styles.logoLink} onClick={() => store.set({ selectedId: null })}>
            <Logo />
          </Link>
          <nav aria-label="Main" className={styles.nav}>
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => cx(styles.navLink, isActive ? styles.navLinkActive : styles.navLinkInactive)}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className={styles.headerRight}>
          {config.useMocks && <span className={styles.mockBadge}>Mock data</span>}
          <NavLink
            to="/settings"
            aria-label="Settings"
            className={({ isActive }) => cx(styles.avatarLink, isActive && styles.avatarLinkActive)}
          >
            {(state.user.name || 'S').charAt(0).toUpperCase()}
          </NavLink>
        </div>
      </header>
      <div className={styles.mainArea}>
        <Outlet />
      </div>
      <Toast />
    </div>
  );
}
