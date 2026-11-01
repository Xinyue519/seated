import type { ConfirmRequest } from '@/types';
import { getRestaurant } from '@/data/restaurants';
import { useApp } from '@/store/AppStore';
import { formatDay } from '@/lib/dates';
import { cx, guests } from '@/lib/format';

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
      className={cx('flex flex-col gap-3.5 rounded-xl border-[1.5px] p-4', c.state === 'open' ? 'border-ink' : 'border-line')}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-semibold uppercase tracking-[0.04em] text-muted">Needs your OK</span>
        <span className="text-base font-semibold">{title}</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {c.state === 'open' ? (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => agent.confirm(messageId)}
              disabled={state.busy}
              className={cx('btn h-11 flex-[1_1_140px] font-semibold text-white', isCancel ? 'bg-danger' : 'bg-accent hover:bg-accent-dark')}
            >
              {isCancel ? 'Yes, cancel it' : isModify ? 'Confirm change' : 'Confirm booking'}
            </button>
            <button
              type="button"
              onClick={() => agent.decline(messageId)}
              disabled={state.busy}
              className="btn h-11 flex-[1_1_100px] border border-line2 bg-white text-[14px]"
            >
              {isCancel ? 'Keep it' : 'Change'}
            </button>
          </div>
          <span className="text-xs text-muted">{isCancel ? 'This cannot be undone.' : 'Nothing is booked until you confirm.'}</span>
        </>
      ) : (
        <span
          className={cx(
            'text-[13px] font-semibold',
            c.state === 'done' ? 'text-ok-text' : c.state === 'failed' ? 'text-danger' : 'text-muted',
          )}
        >
          {c.state === 'done' && isCancel ? 'Cancelled' : STATUS_TEXT[c.state]}
        </span>
      )}
    </section>
  );
}
