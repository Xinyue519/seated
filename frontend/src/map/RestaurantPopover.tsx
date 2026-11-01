import type { Restaurant } from '@/types';
import type { Point } from '@/lib/geo';
import { useApp } from '@/store/AppStore';
import { useAvailability } from '@/hooks/useAvailability';
import { useToggleSaved } from '@/hooks/useSaved';
import { formatDay } from '@/lib/dates';
import { guests, price } from '@/lib/format';
import { BookmarkIcon, CloseIcon } from '@/components/icons';
import SlotButton from '@/components/SlotButton';
import styles from './map.module.css';

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
  const website = r.website;
  return (
    <div
      data-no-pan="true"
      onClick={(e) => e.stopPropagation()}
      className={styles.popover}
      style={{
        left: `${left}%`,
        top: `${point.y}%`,
        transform: above ? 'translate(-50%, calc(-100% - 44px))' : 'translate(-50%, 24px)',
      }}
    >
      <div className={styles.popoverPhoto}>
        {r.imageUrl ? (
          <img src={r.imageUrl} alt={r.name} className={styles.popoverPhotoImg} />
        ) : (
          <div className={styles.popoverPhotoPlaceholder}>[Photo]</div>
        )}
        <button
          type="button"
          aria-label="Close"
          onClick={() => store.set({ selectedId: null })}
          className={styles.popoverCloseButton}
        >
          <CloseIcon size={14} />
        </button>
      </div>
      <div className={styles.popoverBody}>
        <div className={styles.popoverHeaderRow}>
          <div className={styles.popoverTitleBlock}>
            <span className={styles.popoverName}>
              {website ? (
                <a href={website} target="_blank" rel="noopener noreferrer">
                  {r.name}
                </a>
              ) : (
                r.name
              )}
            </span>
            <span className={styles.popoverMeta}>
              {r.cuisine} · {price(r.priceLevel)} · {r.neighborhood}
            </span>
            {website && (
              <a href={website} target="_blank" rel="noopener noreferrer" className={styles.popoverWebsiteButton}>
                Website
              </a>
            )}
          </div>
          <button
            type="button"
            aria-label={saved ? 'Remove from saved' : 'Save'}
            aria-pressed={saved}
            onClick={() => toggleSaved(r.id)}
            className={styles.popoverSaveButton}
          >
            <BookmarkIcon filled={saved} />
          </button>
        </div>
        <p className={styles.popoverDescription}>{r.description}</p>
        <div className={styles.popoverSlotsSection}>
          <span className={styles.popoverSlotsLabel}>
            {formatDay(date)}
            {state.context.partySize ? ` · ${guests(state.context.partySize)}` : ''}
          </span>
          {slots === null ? (
            <span className={styles.popoverMeta}>Checking times…</span>
          ) : slots.length ? (
            <div className={styles.popoverSlotsList}>
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
            <span className={styles.popoverNoTables}>No tables left. Ask Seated for alternatives.</span>
          )}
        </div>
        <span className={styles.popoverFootnote}>Pick a time and Ask Seated handles the booking.</span>
      </div>
    </div>
  );
}
