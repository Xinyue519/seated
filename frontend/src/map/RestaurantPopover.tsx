import type { Restaurant } from '@/types';
import type { Point } from '@/lib/geo';
import { useApp } from '@/store/AppStore';
import { useAvailability } from '@/hooks/useAvailability';
import { useToggleSaved } from '@/hooks/useSaved';
import { formatDay } from '@/lib/dates';
import { guests, price } from '@/lib/format';
import { BookmarkIcon, CloseIcon } from '@/components/icons';
import SlotButton from '@/components/SlotButton';

interface Props {
  restaurant: Restaurant;
  point: Point;
  date: string;
  onPickSlot: (restaurantId: string, time: string, date: string) => void;
}

export default function RestaurantPopover({ restaurant: r, point, date, onPickSlot }: Props) {
  const { state, store } = useApp();
  const slots = useAvailability(r.id, date);
  const toggleSaved = useToggleSaved();
  const saved = state.saved.includes(r.id);
  const above = point.y > 52;
  const left = Math.max(18, Math.min(82, point.x));

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="absolute z-10 w-[300px] max-w-[calc(100%-32px)] overflow-hidden rounded-[14px] bg-white shadow-pop"
      style={{
        left: `${left}%`,
        top: `${point.y}%`,
        transform: above ? 'translate(-50%, calc(-100% - 44px))' : 'translate(-50%, 24px)',
      }}
    >
      <div className="relative flex h-24 items-center justify-center bg-photo text-xs text-muted">
        [Photo]
        <button
          type="button"
          aria-label="Close"
          onClick={() => store.set({ selectedId: null })}
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white"
        >
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="flex flex-col gap-2.5 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-base font-semibold">{r.name}</span>
            <span className="text-[13px] text-muted">
              {r.cuisine} · {price(r.priceLevel)} · {r.neighborhood}
            </span>
          </div>
          <button
            type="button"
            aria-label={saved ? 'Remove from saved' : 'Save'}
            aria-pressed={saved}
            onClick={() => toggleSaved(r.id)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-white"
          >
            <BookmarkIcon filled={saved} />
          </button>
        </div>
        <p className="text-[13px]">{r.description}</p>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">
            {formatDay(date)}
            {state.context.partySize ? ` · ${guests(state.context.partySize)}` : ''}
          </span>
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
                  onClick={() => onPickSlot(r.id, t, date)}
                />
              ))}
            </div>
          ) : (
            <span className="text-[13px] font-medium text-danger">No tables left. Ask Seated for alternatives.</span>
          )}
        </div>
        <span className="text-xs text-muted">Pick a time and Ask Seated handles the booking.</span>
      </div>
    </div>
  );
}
