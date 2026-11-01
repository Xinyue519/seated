import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useApp } from '@/store/AppStore';
import { config } from '@/config';
import Logo from '@/components/Logo';
import MapBackground from '@/map/MapBackground';

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
    <div className="flex min-h-screen flex-wrap bg-white">
      <section aria-hidden="true" className="relative min-h-[320px] flex-[1_1_520px] overflow-hidden bg-map-land">
        <MapBackground />
        {[
          [34, 38],
          [52, 30],
          [28, 58],
        ].map(([x, y]) => (
          <span
            key={`${x}-${y}`}
            className="absolute h-[30px] w-[30px] -rotate-45 border-[3px] border-white bg-accent shadow-pin"
            style={{ left: `${x}%`, top: `${y}%`, borderRadius: '50% 50% 50% 4px' }}
          />
        ))}
        <div className="absolute bottom-10 left-10 right-10 flex max-w-[420px] flex-col gap-1.5 rounded-[14px] bg-white px-[22px] py-5 shadow-pop">
          <span className="text-xl font-semibold tracking-[-0.01em]">Tell it what you're craving.</span>
          <span className="text-muted">Seated finds the table and books it.</span>
        </div>
      </section>

      <section className="flex flex-[1_1_480px] flex-col justify-center px-6 py-12">
        <div className="mx-auto flex w-full max-w-[380px] flex-col gap-7">
          <Logo large />
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Log in</h1>
            <p className="text-muted">Welcome back. Your saved places and bookings are waiting.</p>
          </div>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">Email</span>
              <input className="field" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor="password" className="text-[13px] font-medium">
                  Password
                </label>
                <a href="#" className="text-[13px] text-accent hover:text-accent-dark">
                  Forgot password?
                </a>
              </div>
              <input
                id="password"
                className="field"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-[13px] font-medium text-danger">
                {error}
              </p>
            )}
            <button type="submit" disabled={submitting} className="btn-primary h-[46px]">
              {submitting ? 'Logging in…' : 'Log in'}
            </button>
          </form>
          {config.useMocks && <p className="text-center text-[13px] text-muted">Mock mode: any email and password work.</p>}
        </div>
      </section>
    </div>
  );
}
