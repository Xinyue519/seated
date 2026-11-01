import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getRestaurant } from '@/data/restaurants';
import { useApp } from '@/store/AppStore';
import { dateParts, todayISO } from '@/lib/dates';
import { cx, guests } from '@/lib/format';
import { ThumbDownIcon, ThumbUpIcon } from '@/components/icons';
import common from '@/styles/common.module.css';
import styles from './pages.module.css';

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
    <main className={styles.reservationsMain}>
      <div className={styles.reservationsHeader}>
        <h1 className={styles.reservationsTitle}>Reservations</h1>
        <button type="button" onClick={() => navigate('/')} className={cx(common.btnPrimary, styles.reservationsBookButton)}>
          Ask Seated to book
        </button>
      </div>

      <section aria-labelledby="h-upcoming" className={styles.reservationsSection}>
        <h2 id="h-upcoming" className={common.eyebrow}>
          Upcoming
        </h2>
        {upcoming.length === 0 && <p className={cx(common.card, styles.reservationsEmptyCard)}>No upcoming reservations.</p>}
        {upcoming.map((res) => {
          const r = getRestaurant(res.restaurantId);
          const d = dateParts(res.date);
          const cancelled = res.status === 'cancelled';
          const asking = confirmingCancel === res.id;
          return (
            <article
              key={res.id}
              className={cx(common.card, styles.reservationCard, cancelled && styles.reservationCardCancelled)}
            >
              <div
                className={cx(
                  styles.reservationDateBlock,
                  res.id === firstConfirmed ? styles.reservationDateBlockNext : styles.reservationDateBlockDefault,
                )}
              >
                <span className={styles.reservationDateMonth}>{d.month}</span>
                <span className={styles.reservationDateDay}>{d.day}</span>
                <span className={styles.reservationDateWeekday}>{d.weekday}</span>
              </div>
              <div className={styles.reservationInfo}>
                <div className={styles.reservationNameRow}>
                  <span className={styles.reservationName}>{r.name}</span>
                  <span
                    className={cx(
                      styles.reservationStatusBadge,
                      cancelled ? styles.reservationStatusCancelled : styles.reservationStatusConfirmed,
                    )}
                  >
                    {cancelled ? 'Cancelled' : 'Confirmed'}
                  </span>
                </div>
                <span className={styles.reservationDetail}>
                  {res.time} PM · {guests(res.partySize)} · {r.cuisine} · {r.neighborhood}
                </span>
                <span className={styles.reservationBookedBy}>Booked by {res.bookedBy === 'agent' ? 'Ask Seated' : 'you'}</span>
              </div>
              {!cancelled && !asking && (
                <div className={styles.reservationActions}>
                  <button type="button" onClick={() => askAgent(`Change my ${r.name} reservation`)} className={common.btnOutline}>
                    Modify
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingCancel(res.id)}
                    className={cx(common.btnOutline, styles.reservationCancelButton)}
                  >
                    Cancel
                  </button>
                </div>
              )}
              {asking && (
                <div className={styles.reservationActions}>
                  <span className={styles.reservationConfirmText}>Cancel this booking?</span>
                  <button type="button" onClick={() => cancel(res.id)} className={cx(common.btnBase, styles.reservationDangerButton)}>
                    Yes, cancel
                  </button>
                  <button type="button" onClick={() => setConfirmingCancel(null)} className={common.btnOutline}>
                    Keep it
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </section>

      <section aria-labelledby="h-past" className={styles.reservationsSection}>
        <h2 id="h-past" className={common.eyebrow}>
          Past
        </h2>
        <div className={cx(common.card, styles.reservationsPastCard)}>
          {state.past.map((visit) => {
            const r = getRestaurant(visit.restaurantId);
            const fb = state.feedback[visit.id];
            return (
              <article key={visit.id} className={styles.reservationPastRow}>
                <div className={styles.reservationPastInfo}>
                  <span className={styles.reservationPastName}>{r.name}</span>
                  <span className={styles.reservationPastLabel}>{visit.label}</span>
                </div>
                <div className={styles.reservationActions}>
                  <span className={styles.reservationPastLabel}>{fb ? 'Thanks, noted' : visit.recommended ? 'Good pick?' : 'How was it?'}</span>
                  {(['up', 'down'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-label={v === 'up' ? 'Good pick' : 'Not a good pick'}
                      aria-pressed={fb === v}
                      onClick={() => giveFeedback(visit.id, v, r.name)}
                      className={cx(
                        styles.reservationThumbButton,
                        fb === v ? styles.reservationThumbButtonActive : styles.reservationThumbButtonInactive,
                      )}
                    >
                      {v === 'up' ? <ThumbUpIcon /> : <ThumbDownIcon />}
                    </button>
                  ))}
                  <button type="button" onClick={() => askAgent(`Book ${r.name} this Saturday`)} className={common.btnOutline}>
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
