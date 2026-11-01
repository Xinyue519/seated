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
    <main className="flex min-h-0 flex-1 flex-wrap">
      <MapView
        pins={pins}
        slotDate={resolveDay(state.context.day)}
        onPickSlot={(id, time, date) => {
          navigate('/');
          void agent.pickSlot(id, time, date);
        }}
        toolbar={
          <div className="pointer-events-auto flex min-h-8 items-center gap-2.5 rounded-full bg-white px-3.5 py-1.5 shadow-float">
            <span className="h-2 w-2 rounded-full bg-ink" />
            <span className="font-medium">{items.length} saved places</span>
          </div>
        }
      />

      <aside aria-label="Saved places" className="flex min-h-[480px] max-w-full flex-[1_1_400px] flex-col border-l border-line bg-white md:min-h-0">
        <div className="flex flex-col gap-3.5 border-b border-line p-4">
          <h1 className="text-xl font-semibold tracking-[-0.01em]">Saved</h1>
          <div role="tablist" aria-label="Collections" className="flex flex-wrap gap-1.5">
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
                className={collection === c.id ? 'pill-on' : 'pill-off'}
              >
                {c.label} · {saved.filter((r) => inCollection(r, c.id)).length}
              </button>
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {items.length === 0 && (
            <p className="px-4 py-5 text-muted">Nothing here yet. Tap the bookmark on any restaurant card to save it.</p>
          )}
          {items.map((r) => {
            const been = state.visited.includes(r.id);
            return (
              <article
                key={r.id}
                className={cx('flex items-center gap-3 border-b border-divider px-4 py-3', state.selectedId === r.id && 'bg-panel')}
              >
                <div className="h-[52px] w-[52px] shrink-0 rounded-[10px] bg-photo" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex justify-between gap-2">
                    <button type="button" onClick={() => store.set({ selectedId: r.id })} className="text-left font-semibold hover:underline">
                      {r.name}
                    </button>
                    <span className="text-muted">{price(r.priceLevel)}</span>
                  </div>
                  <span className="text-[13px] text-muted">
                    {r.cuisine} · {r.neighborhood}
                  </span>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <span className={cx('rounded-md px-2 py-0.5 text-xs', been ? 'bg-ok-soft font-medium text-ok-text' : 'bg-chip')}>
                      {been ? 'Visited' : 'Want to try'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${r.name} from saved`}
                  onClick={() => unsave(r)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-white"
                >
                  <BookmarkIcon filled />
                </button>
              </article>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 border-t border-line px-4 pb-4 pt-3.5">
          <span className="text-xs text-muted">Ask Seated about your saved places</span>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => ask("Find somewhere similar to my saved places that I haven't been to")} className="pill-off font-normal">
              Find similar I haven't tried
            </button>
            <button type="button" onClick={() => ask('Book one from my saved list for Saturday')} className="pill-off font-normal">
              Book one of these for Saturday
            </button>
          </div>
        </div>
      </aside>
    </main>
  );
}
