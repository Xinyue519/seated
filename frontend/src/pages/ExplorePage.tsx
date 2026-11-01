import { allRestaurants } from '@/data/restaurants';
import { useApp } from '@/store/AppStore';
import { resolveDay } from '@/lib/dates';
import MapView, { type PinSpec } from '@/map/MapView';
import PlacesSearch from '@/map/PlacesSearch';
import AgentPanel from '@/chat/AgentPanel';
import styles from './pages.module.css';

export default function ExplorePage() {
  const { state, store, agent } = useApp();
  const filter = state.mapFilter;

  const restaurants = allRestaurants();
  const pins: PinSpec[] = restaurants.map((r) => {
    const idx = filter ? filter.indexOf(r.id) : -1;
    if (filter && idx >= 0) return { restaurant: r, variant: 'result', label: String(idx + 1) };
    return { restaurant: r, variant: filter ? 'dim' : 'default' };
  });

  return (
    <main className={styles.exploreMain}>
      <MapView
        pins={pins}
        slotDate={resolveDay(state.context.day)}
        onPickSlot={(id, time, date) => agent.pickSlot(id, time, date)}
        toolbar={
          <>
            <PlacesSearch />
            <div className={styles.exploreToolbar}>
              <span className={styles.exploreToolbarDot} />
              <span className={styles.exploreToolbarLabel}>
                {filter ? `${filter.length} results from Ask Seated` : `${restaurants.length} bookable restaurants`}
              </span>
              {filter && (
                <button type="button" onClick={() => store.set({ mapFilter: null })} className={styles.exploreShowAllButton}>
                  Show all
                </button>
              )}
            </div>
          </>
        }
      />
      <AgentPanel />
    </main>
  );
}
