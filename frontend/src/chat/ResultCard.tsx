import type { ResultItem } from '@/types';
import { getRestaurant } from '@/data/restaurants';
import { useApp } from '@/store/AppStore';
import { useAvailability } from '@/hooks/useAvailability';
import { formatDay } from '@/lib/dates';
import { cx, price } from '@/lib/format';
import SlotButton from '@/components/SlotButton';
import styles from './chat.module.css';

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
    <article className={cx(styles.resultCard, state.selectedId === r.id ? styles.resultCardSelected : styles.resultCardDefault)}>
      <div className={styles.resultHeader}>
        <span className={styles.indexBadge}>{index + 1}</span>
        <div className={styles.titleColumn}>
          <div className={styles.nameRow}>
            <button type="button" onClick={() => store.set({ selectedId: r.id })} className={styles.nameButton}>
              {r.name}
            </button>
            <span className={styles.priceText}>{price(r.priceLevel)}</span>
          </div>
          <span className={styles.metaText}>
            {r.cuisine} · {r.neighborhood}
            {saved ? ' · Saved' : ''}
          </span>
        </div>
      </div>
      <p className={styles.description}>{r.description}</p>
      {item.reasons.length > 0 && <span className={styles.reasonsText}>{item.reasons.slice(0, 3).join(' · ')}</span>}
      {slots === null ? (
        <span className={styles.metaText}>Checking times…</span>
      ) : slots.length ? (
        <div className={styles.slotsRow}>
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
        <span className={styles.fullyBookedText}>Fully booked {formatDay(date)}</span>
      )}
    </article>
  );
}
