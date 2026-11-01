import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
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
  const { state, store, logout } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
    navigate('/login');
  };

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
          <div ref={menuRef} className={styles.avatarMenuWrap}>
            <button
              type="button"
              aria-label="Account menu"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
              className={cx(styles.avatarLink, (menuOpen || location.pathname === '/settings') && styles.avatarLinkActive)}
            >
              {(state.user.name || 'S').charAt(0).toUpperCase()}
            </button>
            {menuOpen && (
              <div role="menu" aria-label="Account" className={styles.avatarMenu}>
                <Link to="/settings" role="menuitem" onClick={() => setMenuOpen(false)} className={styles.avatarMenuItem}>
                  Settings
                </Link>
                <button type="button" role="menuitem" onClick={handleLogout} className={styles.avatarMenuItem}>
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <div className={styles.mainArea}>
        <Outlet />
      </div>
      <Toast />
    </div>
  );
}
