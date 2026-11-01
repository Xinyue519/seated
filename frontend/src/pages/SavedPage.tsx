import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Restaurant } from '@/types';
import { allRestaurants } from '@/data/restaurants';
import { useToggleSaved } from '@/hooks/useSaved';
import { useApp } from '@/store/AppStore';
import { resolveDay } from '@/lib/dates';
import { cx, price } from '@/lib/format';
import { BookmarkIcon } from '@/components/icons';
import MapView, { type PinSpec } from '@/map/MapView';
import common from '@/styles/common.module.css';
import styles from './pages.module.css';

type Collection = 'all' | 'been' | 'try' | 'italian';

const COLLECTIONS: Array<{ id: Collection; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'been', label: 'Been there' },
  { id: 'try', label: 'Want to try' },
  { id: 'italian', label: 'Italian' },
];

export default function SavedPage() {
  const { state, store, agent } = useApp();
  const toggleSaved = useToggleSaved();
  const navigate = useNavigate();
  const [collection, setCollection] = useState<Collection>('all');

  const inCollection = (r: Restaurant, c: Collection) => {
    if (c === 'been') return state.visited.includes(r.id);
    if (c === 'try') return !state.visited.includes(r.id);
    if (c === 'italian') return r.group === 'italian' || r.group === 'pizza';
    return true;
  };
  const saved = allRestaurants().filter((r) => state.saved.includes(r.id));
  const items = saved.filter((r) => inCollection(r, collection));
  const pins: PinSpec[] = items.map((r) => ({ restaurant: r, variant: 'saved' }));

  const unsave = (r: Restaurant) => void toggleSaved(r.id);

  const ask = (text: string) => {
    navigate('/');
    void agent.send(text);
  };

  return (
    <main className={styles.savedMain}>
      <MapView
        pins={pins}
        slotDate={resolveDay(state.context.day)}
        onPickSlot={(id, time, date) => {
          navigate('/');
          void agent.pickSlot(id, time, date);
        }}
        toolbar={
          <div className={styles.savedToolbar}>
            <span className={styles.savedToolbarDot} />
            <span className={styles.savedToolbarLabel}>{items.length} saved places</span>
          </div>
        }
      />

      <aside aria-label="Saved places" className={styles.savedAside}>
        <div className={styles.savedHeader}>
          <h1 className={styles.savedTitle}>Saved</h1>
          <div role="tablist" aria-label="Collections" className={styles.savedTabs}>
            {COLLECTIONS.map((c) => (
              <button
                key={c.id}
                role="tab"
                type="button"
                aria-selected={collection === c.id}
                onClick={() => {
                  setCollection(c.id);
                  store.set({ selectedId: null });
                }}
                className={collection === c.id ? common.pillOn : common.pillOff}
              >
                {c.label} · {saved.filter((r) => inCollection(r, c.id)).length}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.savedList}>
          {items.length === 0 && (
            <p className={styles.savedEmpty}>Nothing here yet. Tap the bookmark on any restaurant card to save it.</p>
          )}
          {items.map((r) => {
            const been = state.visited.includes(r.id);
            return (
              <article key={r.id} className={cx(styles.savedItem, state.selectedId === r.id && styles.savedItemSelected)}>
                <div className={styles.savedItemPhoto}>
                  {r.imageUrl && <img src={r.imageUrl} alt={r.name} className={styles.savedItemPhotoImg} />}
                </div>
                <div className={styles.savedItemInfo}>
                  <div className={styles.savedItemNameRow}>
                    <button type="button" onClick={() => store.set({ selectedId: r.id })} className={styles.savedItemName}>
                      {r.name}
                    </button>
                    <span className={styles.savedItemPrice}>{price(r.priceLevel)}</span>
                  </div>
                  <span className={styles.savedItemDetail}>
                    {r.cuisine} · {r.neighborhood}
                  </span>
                  <div className={styles.savedItemBadges}>
                    <span className={cx(styles.savedBadge, been ? styles.savedBadgeVisited : styles.savedBadgeTry)}>
                      {been ? 'Visited' : 'Want to try'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${r.name} from saved`}
                  onClick={() => unsave(r)}
                  className={styles.savedRemoveButton}
                >
                  <BookmarkIcon filled />
                </button>
              </article>
            );
          })}
        </div>

        <div className={styles.savedFooter}>
          <span className={styles.savedFooterLabel}>Ask Seated about your saved places</span>
          <div className={styles.savedFooterButtons}>
            <button
              type="button"
              onClick={() => ask("Find somewhere similar to my saved places that I haven't been to")}
              className={cx(common.pillOff, styles.savedFooterPill)}
            >
              Find similar I haven't tried
            </button>
            <button
              type="button"
              onClick={() => ask('Book one from my saved list for Saturday')}
              className={cx(common.pillOff, styles.savedFooterPill)}
            >
              Book one of these for Saturday
            </button>
          </div>
        </div>
      </aside>
    </main>
  );
}
