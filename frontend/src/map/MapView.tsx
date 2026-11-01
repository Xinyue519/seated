import { useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import type { Restaurant } from '@/types';
import { findRestaurant, NEIGHBORHOODS } from '@/data/restaurants';
import { project, type Point } from '@/lib/geo';
import { useApp } from '@/store/AppStore';
import { MinusIcon, PlusIcon } from '@/components/icons';
import MapBackground from './MapBackground';
import RestaurantPopover from './RestaurantPopover';

export type PinVariant = 'result' | 'saved' | 'default' | 'dim';

export interface PinSpec {
  restaurant: Restaurant;
  variant: PinVariant;
  /** Number shown on result pins. */
  label?: string;
}

interface Props {
  pins: PinSpec[];
  toolbar?: ReactNode;
  slotDate: string;
  onPickSlot: (restaurantId: string, time: string, date: string) => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export default function MapView({ pins, toolbar, slotDate, onPickSlot }: Props) {
  const { state, store } = useApp();
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<Point>({ x: 50, y: 50 });
  const [panning, setPanning] = useState(false);
  const dragRef = useRef<{ x: number; y: number; center: Point } | null>(null);
  const didPanRef = useRef(false);

  const toScreen = (p: Point): Point => ({ x: 50 + (p.x - center.x) * zoom, y: 50 + (p.y - center.y) * zoom });
  const visible = (p: Point) => p.x > -3 && p.x < 103 && p.y > -3 && p.y < 103;

  const handlePointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, [data-no-pan]')) return;
    dragRef.current = { x: e.clientX, y: e.clientY, center };
    didPanRef.current = false;
    setPanning(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const handlePointerMove = (e: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didPanRef.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    setCenter({
      x: clamp(drag.center.x - (dx / rect.width) * 100 / zoom, 0, 100),
      y: clamp(drag.center.y - (dy / rect.height) * 100 / zoom, 0, 100),
    });
  };
  const handlePointerUp = () => {
    dragRef.current = null;
    setPanning(false);
  };
  const handleBackgroundClick = () => {
    if (didPanRef.current) {
      didPanRef.current = false;
      return;
    }
    store.set({ selectedId: null });
  };

  const zoomIn = () => {
    const sel = state.selectedId ? findRestaurant(state.selectedId) : undefined;
    setCenter(sel ? project(sel.lat, sel.lng) : center);
    setZoom((z) => Math.min(MAX_ZOOM, z + 0.5));
  };
  const zoomOut = () => {
    const z = Math.max(MIN_ZOOM, zoom - 0.5);
    setZoom(z);
    if (z === 1) setCenter({ x: 50, y: 50 });
  };

  const selected = state.selectedId ? findRestaurant(state.selectedId) : undefined;
  const selectedPoint = selected ? toScreen(project(selected.lat, selected.lng)) : undefined;

  return (
    <section
      aria-label="Map"
      className={`relative min-h-[480px] min-w-0 flex-[999_1_560px] overflow-hidden bg-map-land ${panning ? 'cursor-grabbing select-none' : 'cursor-grab'}`}
      style={{ touchAction: 'none' }}
      onClick={handleBackgroundClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <MapBackground
        style={{
          transformOrigin: `${center.x}% ${center.y}%`,
          transform: `translate(${50 - center.x}%, ${50 - center.y}%) scale(${zoom})`,
        }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-[1.5%] top-1/2 origin-top-left -rotate-90 text-xs tracking-[3px] text-map-river"
      >
        HUDSON RIVER
      </span>

      {Object.entries(NEIGHBORHOODS).map(([name, [lat, lng]]) => {
        const p = toScreen(project(lat, lng));
        if (!visible(p)) return null;
        return (
          <span
            key={name}
            aria-hidden="true"
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] font-semibold tracking-[2px] text-map-label"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
          >
            {name.toUpperCase()}
          </span>
        );
      })}

      {toolbar && (
        <div
          data-no-pan="true"
          className="pointer-events-none absolute left-4 right-4 top-4 z-[6] flex flex-wrap items-center gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          {toolbar}
        </div>
      )}

      {pins.map((pin) => {
        const p = toScreen(project(pin.restaurant.lat, pin.restaurant.lng));
        if (!visible(p)) return null;
        return (
          <Pin
            key={pin.restaurant.id}
            pin={pin}
            point={p}
            selected={state.selectedId === pin.restaurant.id}
            onSelect={() => store.set({ selectedId: pin.restaurant.id })}
          />
        );
      })}

      {selected && selectedPoint && (
        <RestaurantPopover restaurant={selected} point={selectedPoint} date={slotDate} onPickSlot={onPickSlot} />
      )}

      <div
        data-no-pan="true"
        className="absolute bottom-4 right-4 z-[7] flex flex-col overflow-hidden rounded-[10px] bg-white shadow-float"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Zoom in"
          onClick={zoomIn}
          disabled={zoom >= MAX_ZOOM}
          className="flex h-11 w-11 items-center justify-center text-ink disabled:text-[#B9B5AB]"
        >
          <PlusIcon />
        </button>
        <span className="h-px bg-line" />
        <button
          type="button"
          aria-label="Zoom out"
          onClick={zoomOut}
          disabled={zoom <= MIN_ZOOM}
          className="flex h-11 w-11 items-center justify-center text-ink disabled:text-[#B9B5AB]"
        >
          <MinusIcon />
        </button>
      </div>
    </section>
  );
}

function Pin({ pin, point, selected, onSelect }: { pin: PinSpec; point: Point; selected: boolean; onSelect: () => void }) {
  const { state } = useApp();
  const pos: CSSProperties = { left: `${point.x}%`, top: `${point.y}%` };
  const click = (e: MouseEvent) => {
    e.stopPropagation();
    onSelect();
  };

  if (pin.variant === 'result') {
    const size = selected ? 42 : 34;
    return (
      <button
        type="button"
        aria-label={pin.restaurant.name}
        title={pin.restaurant.name}
        onClick={click}
        className="absolute flex items-center justify-center border-[3px] border-white bg-accent p-0 shadow-pin"
        style={{
          ...pos,
          width: size,
          height: size,
          margin: `-${size + 4}px 0 0 -${size / 2}px`,
          borderRadius: '50% 50% 50% 4px',
          transform: 'rotate(-45deg)',
          zIndex: selected ? 5 : 4,
          boxShadow: selected ? '0 0 0 6px rgba(194,62,34,0.22), 0 4px 10px rgba(23,25,30,0.25)' : undefined,
        }}
      >
        <span className="rotate-45 text-[13px] font-bold text-white">{pin.label}</span>
      </button>
    );
  }

  if (pin.variant === 'saved') {
    const size = selected ? 36 : 28;
    return (
      <button
        type="button"
        aria-label={pin.restaurant.name}
        title={pin.restaurant.name}
        onClick={click}
        className="absolute flex items-center justify-center rounded-full border-[3px] border-white bg-ink p-0 shadow-pin"
        style={{
          ...pos,
          width: size,
          height: size,
          margin: `-${size / 2}px 0 0 -${size / 2}px`,
          zIndex: selected ? 5 : 3,
          boxShadow: selected ? '0 0 0 6px rgba(23,25,30,0.18), 0 4px 10px rgba(23,25,30,0.25)' : undefined,
        }}
      >
        <span className="h-2 w-2 rounded-full bg-white" />
      </button>
    );
  }

  const dim = pin.variant === 'dim';
  const size = selected ? 22 : dim ? 14 : 18;
  const color = dim ? '#B0ACA2' : state.saved.includes(pin.restaurant.id) ? '#17191E' : '#C23E22';
  return (
    <button
      type="button"
      aria-label={pin.restaurant.name}
      title={pin.restaurant.name}
      onClick={click}
      className="absolute rounded-full border-2 border-white p-0 shadow-[0_2px_6px_rgba(23,25,30,0.2)]"
      style={{ ...pos, width: size, height: size, margin: `-${size / 2}px 0 0 -${size / 2}px`, background: color, zIndex: selected ? 5 : 2 }}
    />
  );
}
