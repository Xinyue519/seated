import type { ConfirmRequest } from '@/types';
import { getRestaurant } from '@/data/restaurants';
import { useApp } from '@/store/AppStore';
import { formatDay } from '@/lib/dates';
import { cx, guests } from '@/lib/format';
import common from '@/styles/common.module.css';
import styles from './chat.module.css';

const STATUS_TEXT: Record<ConfirmRequest['state'], string> = {
  open: '',
  working: 'Working on it…',
  done: 'Confirmed',
  failed: 'Booking failed · slot taken',
  declined: 'Not confirmed',
};

/** Human-in-the-loop approval: consequential actions never run without this. */
export default function ConfirmCard({ messageId, request: c }: { messageId: string; request: ConfirmRequest }) {
  const { state, agent } = useApp();
  const r = getRestaurant(c.restaurantId);
  const isCancel = c.kind === 'cancel';
  const isModify = c.kind === 'modify';
  const title = isCancel ? `Cancel ${r.name}?` : isModify ? `Move ${r.name} to ${c.time}?` : `Book ${r.name}?`;
  const rows: Array<[string, string]> = [
    ['When', `${formatDay(c.date)} · ${c.time} PM`],
    ['Party', guests(c.partySize)],
    ['Name', state.user.name],
    ['Where', r.neighborhood],
  ];

  return (
    <section
      aria-label={title}
      className={cx(styles.confirmCard, c.state === 'open' ? styles.confirmCardOpen : styles.confirmCardClosed)}
    >
      <div className={styles.cardHeader}>
        <span className={common.eyebrow}>Needs your OK</span>
        <span className={styles.cardTitle}>{title}</span>
      </div>
      <dl className={styles.detailGrid}>
        {rows.map(([k, v]) => (
          <div key={k} className={styles.detailRow}>
            <dt className={styles.detailLabel}>{k}</dt>
            <dd className={styles.detailValue}>{v}</dd>
          </div>
        ))}
      </dl>
      {c.state === 'open' ? (
        <>
          <div className={styles.actions}>
            <button
              type="button"
              onClick={() => agent.confirm(messageId)}
              disabled={state.busy}
              className={cx(
                common.btnBase,
                styles.confirmButton,
                isCancel ? styles.confirmButtonDanger : styles.confirmButtonAccent,
              )}
            >
              {isCancel ? 'Yes, cancel it' : isModify ? 'Confirm change' : 'Confirm booking'}
            </button>
            <button
              type="button"
              onClick={() => agent.decline(messageId)}
              disabled={state.busy}
              className={cx(common.btnBase, styles.declineButton)}
            >
              {isCancel ? 'Keep it' : 'Change'}
            </button>
          </div>
          <span className={styles.helperText}>{isCancel ? 'This cannot be undone.' : 'Nothing is booked until you confirm.'}</span>
        </>
      ) : (
        <span
          className={cx(
            styles.statusText,
            c.state === 'done' ? styles.statusDone : c.state === 'failed' ? styles.statusFailed : styles.statusNeutral,
          )}
        >
          {c.state === 'done' && isCancel ? 'Cancelled' : STATUS_TEXT[c.state]}
        </span>
      )}
    </section>
  );
}
