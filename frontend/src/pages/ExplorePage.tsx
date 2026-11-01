import { allRestaurants } from '@/data/restaurants';
import { useApp } from '@/store/AppStore';
import { resolveDay } from '@/lib/dates';
import MapView, { type PinSpec } from '@/map/MapView';
import AgentPanel from '@/chat/AgentPanel';

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
    <main className="flex min-h-0 flex-1 flex-wrap">
      <MapView
        pins={pins}
        slotDate={resolveDay(state.context.day)}
        onPickSlot={(id, time, date) => agent.pickSlot(id, time, date)}
        toolbar={
          <div className="pointer-events-auto flex min-h-8 items-center gap-2.5 rounded-full bg-white py-1.5 pl-3.5 pr-1.5 shadow-float">
            <span className="h-2 w-2 rounded-full bg-accent" />
            <span className="font-medium">
              {filter ? `${filter.length} results from Ask Seated` : `${restaurants.length} bookable restaurants`}
            </span>
            {filter && (
              <button
                type="button"
                onClick={() => store.set({ mapFilter: null })}
                className="h-8 rounded-full border border-line bg-white px-3 text-[13px] font-medium"
              >
                Show all
              </button>
            )}
          </div>
        }
      />
      <AgentPanel />
    </main>
  );
}
