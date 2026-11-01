import type { ResultItem } from '@/types';
import { getRestaurant } from '@/data/restaurants';
import { useApp } from '@/store/AppStore';
import { useAvailability } from '@/hooks/useAvailability';
import { formatDay } from '@/lib/dates';
import { cx, price } from '@/lib/format';
import SlotButton from '@/components/SlotButton';

interface Props {
  item: ResultItem;
  index: number;
  date: string;
}

export default function ResultCard({ item, index, date }: Props) {
  const { state, store, agent } = useApp();
  const r = getRestaurant(item.restaurantId);
  const slots = useAvailability(r.id, date);
  const saved = state.saved.includes(r.id);

  return (
    <article
      className={cx(
        'flex flex-col gap-2.5 rounded-xl border p-3.5',
        state.selectedId === r.id ? 'border-ink' : 'border-line',
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
          {index + 1}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex justify-between gap-2">
            <button
              type="button"
              onClick={() => store.set({ selectedId: r.id })}
              className="text-left text-[15px] font-semibold hover:underline"
            >
              {r.name}
            </button>
            <span className="text-muted">{price(r.priceLevel)}</span>
          </div>
          <span className="text-[13px] text-muted">
            {r.cuisine} · {r.neighborhood}
            {saved ? ' · Saved' : ''}
          </span>
        </div>
      </div>
      <p className="text-[13px]">{r.description}</p>
      {item.reasons.length > 0 && (
        <span className="text-xs font-medium text-ok-text">{item.reasons.slice(0, 3).join(' · ')}</span>
      )}
      {slots === null ? (
        <span className="text-[13px] text-muted">Checking times…</span>
      ) : slots.length ? (
        <div className="flex flex-wrap gap-1.5">
          {slots.map((t) => (
            <SlotButton
              key={t}
              time={t}
              disabled={state.busy}
              selected={state.pending?.restaurantId === r.id && state.pending.time === t}
              hinted={state.context.time === t}
              onClick={() => agent.pickSlot(r.id, t, date)}
            />
          ))}
        </div>
      ) : (
        <span className="text-[13px] font-medium text-danger">Fully booked {formatDay(date)}</span>
      )}
    </article>
  );
}
