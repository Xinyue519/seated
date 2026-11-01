import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useApp } from '@/store/AppStore';
import { config } from '@/config';
import Logo from '@/components/Logo';
import MapBackground from '@/map/MapBackground';
import common from '@/styles/common.module.css';
import styles from './pages.module.css';
import { cx } from '@/lib/format';

export default function LoginPage() {
  const { state, login } = useApp();
  const navigate = useNavigate();
  const [email, setEmail] = useState(config.useMocks ? 'stella@example.com' : '');
  const [password, setPassword] = useState(config.useMocks ? 'demo-password' : '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (state.authed) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(
        (err as Error).name === 'UnauthorizedError'
          ? 'That email and password don’t match.'
          : `Couldn't reach Seated. Is the backend running? (${(err as Error).message})`,
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.loginRoot}>
      <section aria-hidden="true" className={styles.loginMapSection}>
        <MapBackground />
        {[
          [34, 38],
          [52, 30],
          [28, 58],
        ].map(([x, y]) => (
          <span
            key={`${x}-${y}`}
            className={styles.loginMapPin}
            style={{ left: `${x}%`, top: `${y}%`, borderRadius: '50% 50% 50% 4px' }}
          />
        ))}
        <div className={styles.loginMapCaption}>
          <span className={styles.loginMapCaptionTitle}>Tell it what you're craving.</span>
          <span className={styles.loginMapCaptionSubtitle}>Seated finds the table and books it.</span>
        </div>
      </section>

      <section className={styles.loginFormSection}>
        <div className={styles.loginFormWrap}>
          <Logo large />
          <div className={styles.loginHeading}>
            <h1 className={styles.loginTitle}>Log in</h1>
            <p className={styles.loginSubtitle}>Welcome back. Your saved places and bookings are waiting.</p>
          </div>
          <form onSubmit={submit} className={styles.loginForm}>
            <label className={styles.loginFieldGroup}>
              <span className={styles.loginFieldLabel}>Email</span>
              <input className={common.field} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <div className={styles.loginFieldGroup}>
              <div className={styles.loginPasswordRow}>
                <label htmlFor="password" className={styles.loginFieldLabel}>
                  Password
                </label>
                <a href="#" className={styles.loginForgotLink}>
                  Forgot password?
                </a>
              </div>
              <input
                id="password"
                className={common.field}
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className={styles.loginError}>
                {error}
              </p>
            )}
            <button type="submit" disabled={submitting} className={cx(common.btnPrimary, styles.loginSubmitButton)}>
              {submitting ? 'Logging in…' : 'Log in'}
            </button>
          </form>
          {config.useMocks && <p className={styles.loginMockNote}>Mock mode: any email and password work.</p>}
        </div>
      </section>
    </div>
  );
}
