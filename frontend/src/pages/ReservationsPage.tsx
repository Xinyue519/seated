import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getRestaurant } from '@/data/restaurants';
import { useApp } from '@/store/AppStore';
import { dateParts, todayISO } from '@/lib/dates';
import { cx, guests } from '@/lib/format';
import { ThumbDownIcon, ThumbUpIcon } from '@/components/icons';

export default function ReservationsPage() {
  const { state, store, api, agent, toast } = useApp();
  const navigate = useNavigate();
  const [confirmingCancel, setConfirmingCancel] = useState<string | null>(null);

  const today = todayISO();
  const upcoming = state.reservations.filter((r) => r.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const firstConfirmed = upcoming.find((r) => r.status === 'confirmed')?.id;

  const askAgent = (text: string) => {
    navigate('/');
    void agent.send(text);
  };

  const cancel = async (id: string) => {
    setConfirmingCancel(null);
    const name = getRestaurant(state.reservations.find((r) => r.id === id)!.restaurantId).name;
    await agent.cancelReservation(id);
    toast(`${name} reservation cancelled`);
  };

  const giveFeedback = (visitId: string, value: 'up' | 'down', name: string) => {
    store.set((s) => ({ feedback: { ...s.feedback, [visitId]: value } }));
    void api.sendFeedback(visitId, value).catch(() => undefined);
    toast(value === 'up' ? `Thanks. Ask Seated will suggest more like ${name}.` : `Got it. Ask Seated will show fewer places like ${name}.`);
  };

  return (
    <main className="mx-auto flex w-full max-w-[880px] flex-1 flex-col gap-8 overflow-y-auto px-6 pb-16 pt-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Reservations</h1>
        <button type="button" onClick={() => navigate('/')} className="btn-primary h-10 px-3.5 font-medium">
          Ask Seated to book
        </button>
      </div>

      <section aria-labelledby="h-upcoming" className="flex flex-col gap-3">
        <h2 id="h-upcoming" className="eyebrow">
          Upcoming
        </h2>
        {upcoming.length === 0 && <p className="card p-5 text-muted">No upcoming reservations.</p>}
        {upcoming.map((res) => {
          const r = getRestaurant(res.restaurantId);
          const d = dateParts(res.date);
          const cancelled = res.status === 'cancelled';
          const asking = confirmingCancel === res.id;
          return (
            <article key={res.id} className={cx('card flex flex-wrap items-center gap-5 p-5', cancelled && 'opacity-60')}>
              <div
                className={cx(
                  'flex w-[76px] shrink-0 flex-col items-center justify-center rounded-[10px] py-2.5',
                  res.id === firstConfirmed ? 'bg-accent-soft text-accent-dark' : 'bg-chip',
                )}
              >
                <span className="text-xs font-semibold tracking-[0.06em]">{d.month}</span>
                <span className="text-[28px] font-bold leading-tight">{d.day}</span>
                <span className="text-xs font-medium">{d.weekday}</span>
              </div>
              <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-lg font-semibold">{r.name}</span>
                  <span
                    className={cx(
                      'rounded-md px-2 py-0.5 text-xs font-semibold',
                      cancelled ? 'bg-chip text-muted' : 'bg-ok-soft text-ok-text',
                    )}
                  >
                    {cancelled ? 'Cancelled' : 'Confirmed'}
                  </span>
                </div>
                <span className="text-muted">
                  {res.time} PM · {guests(res.partySize)} · {r.cuisine} · {r.neighborhood}
                </span>
                <span className="text-[13px] text-muted">Booked by {res.bookedBy === 'agent' ? 'Ask Seated' : 'you'}</span>
              </div>
              {!cancelled && !asking && (
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => askAgent(`Change my ${r.name} reservation`)} className="btn-outline">
                    Modify
                  </button>
                  <button type="button" onClick={() => setConfirmingCancel(res.id)} className="btn-outline text-danger">
                    Cancel
                  </button>
                </div>
              )}
              {asking && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium">Cancel this booking?</span>
                  <button type="button" onClick={() => cancel(res.id)} className="btn h-10 bg-danger px-3.5 text-[13px] font-semibold text-white">
                    Yes, cancel
                  </button>
                  <button type="button" onClick={() => setConfirmingCancel(null)} className="btn-outline">
                    Keep it
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </section>

      <section aria-labelledby="h-past" className="flex flex-col gap-3">
        <h2 id="h-past" className="eyebrow">
          Past
        </h2>
        <div className="card overflow-hidden">
          {state.past.map((visit) => {
            const r = getRestaurant(visit.restaurantId);
            const fb = state.feedback[visit.id];
            return (
              <article key={visit.id} className="flex flex-wrap items-center gap-4 border-b border-divider px-5 py-4 last:border-b-0">
                <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-0.5">
                  <span className="font-semibold">{r.name}</span>
                  <span className="text-[13px] text-muted">{visit.label}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-muted">{fb ? 'Thanks, noted' : visit.recommended ? 'Good pick?' : 'How was it?'}</span>
                  {(['up', 'down'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-label={v === 'up' ? 'Good pick' : 'Not a good pick'}
                      aria-pressed={fb === v}
                      onClick={() => giveFeedback(visit.id, v, r.name)}
                      className={cx(
                        'flex h-10 w-10 items-center justify-center rounded-[10px] border',
                        fb === v ? 'border-ink bg-ink text-white' : 'border-line2 bg-white',
                      )}
                    >
                      {v === 'up' ? <ThumbUpIcon /> : <ThumbDownIcon />}
                    </button>
                  ))}
                  <button type="button" onClick={() => askAgent(`Book ${r.name} this Saturday`)} className="btn-outline">
                    Book again
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
