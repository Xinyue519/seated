import { useCallback, useEffect, useRef, useState } from 'react';
import { AdvancedMarker, AdvancedMarkerAnchorPoint, APIProvider, Map, useMap } from '@vis.gl/react-google-maps';
import { config } from '@/config';
import { findRestaurant } from '@/data/restaurants';
import type { Point } from '@/lib/geo';
import { useApp } from '@/store/AppStore';
import { MinusIcon, PlusIcon } from '@/components/icons';
import RestaurantPopover from './RestaurantPopover';
import type { MapViewProps, PinSpec } from './PlaceholderMapView';
import styles from './map.module.css';

const NYC_CENTER = { lat: 40.7285, lng: -73.9985 };

export default function GoogleMapView(props: MapViewProps) {
  return (
    <section aria-label="Map" className={styles.mapSection}>
      <APIProvider apiKey={config.googleMapsApiKey}>
        <Inner {...props} />
      </APIProvider>
    </section>
  );
}

function Inner({ pins, toolbar, slotDate, onPickSlot }: MapViewProps) {
  const { state, store } = useApp();
  const map = useMap();
  const [, setTick] = useState(0); // re-render on pan/zoom so the popover follows its pin
  const fittedRef = useRef('');

  useEffect(() => {
    if (!map) return;
    const l = map.addListener('bounds_changed', () => setTick((t) => t + 1));
    return () => l.remove();
  }, [map]);

  // Frame the Ask Seated results whenever the result set changes.
  const resultKey = pins.filter((p) => p.variant === 'result').map((p) => p.restaurant.id).join(',');
  useEffect(() => {
    if (!map || resultKey === fittedRef.current) return;
    fittedRef.current = resultKey;
    if (!resultKey) return;
    const bounds = new google.maps.LatLngBounds();
    pins.filter((p) => p.variant === 'result').forEach((p) => bounds.extend({ lat: p.restaurant.lat, lng: p.restaurant.lng }));
    map.fitBounds(bounds, { top: 90, bottom: 60, left: 60, right: 60 });
    if ((map.getZoom() ?? 0) > 16) map.setZoom(16);
  }, [map, resultKey, pins]);

  const selected = state.selectedId ? findRestaurant(state.selectedId) : undefined;
  const selectedPoint = map && selected ? toPercent(map, selected.lat, selected.lng) : null;

  // If a selection comes from outside the map (e.g. a result card), bring it into view.
  useEffect(() => {
    if (!map || !selected) return;
    const p = toPercent(map, selected.lat, selected.lng);
    if (!p || p.x < 12 || p.x > 88 || p.y < 12 || p.y > 88) map.panTo({ lat: selected.lat, lng: selected.lng });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, state.selectedId]);

  const zoomBy = useCallback((d: number) => map?.setZoom((map.getZoom() ?? 13) + d), [map]);

  return (
    <>
      <Map
        mapId={config.googleMapId}
        defaultCenter={NYC_CENTER}
        defaultZoom={14}
        minZoom={11}
        maxZoom={19}
        disableDefaultUI
        clickableIcons={false}
        gestureHandling="greedy"
        style={{ position: 'absolute', inset: 0 }}
        onClick={() => store.set({ selectedId: null })}
      >
        {pins.map((pin) => (
          <AdvancedMarker
            key={pin.restaurant.id}
            position={{ lat: pin.restaurant.lat, lng: pin.restaurant.lng }}
            title={pin.restaurant.name}
            anchorPoint={pin.variant === 'result' ? AdvancedMarkerAnchorPoint.BOTTOM : AdvancedMarkerAnchorPoint.CENTER}
            zIndex={markerZ(pin, state.selectedId === pin.restaurant.id)}
            onClick={() => store.set({ selectedId: pin.restaurant.id })}
          >
            <PinGlyph pin={pin} selected={state.selectedId === pin.restaurant.id} saved={state.saved.includes(pin.restaurant.id)} />
          </AdvancedMarker>
        ))}
      </Map>

      {toolbar && (
        <div
          data-no-pan="true"
          className={styles.toolbarLayer}
          onClick={(e) => e.stopPropagation()}
        >
          {toolbar}
        </div>
      )}

      {selected && selectedPoint && (
        <RestaurantPopover restaurant={selected} point={selectedPoint} date={slotDate} onPickSlot={onPickSlot} />
      )}

      <div data-no-pan="true" className={styles.zoomControls}>
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1)} className={styles.zoomButton}>
          <PlusIcon />
        </button>
        <span className={styles.zoomDivider} />
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(-1)} className={styles.zoomButton}>
          <MinusIcon />
        </button>
      </div>
    </>
  );
}

/** Lat/lng → percent of the map container (valid because the map is never tilted or rotated). */
function toPercent(map: google.maps.Map, lat: number, lng: number): Point | null {
  const proj = map.getProjection();
  const b = map.getBounds();
  if (!proj || !b) return null;
  const ne = proj.fromLatLngToPoint(b.getNorthEast());
  const sw = proj.fromLatLngToPoint(b.getSouthWest());
  const p = proj.fromLatLngToPoint(new google.maps.LatLng(lat, lng));
  if (!ne || !sw || !p) return null;
  return {
    x: ((p.x - sw.x) / (ne.x - sw.x)) * 100,
    y: ((p.y - ne.y) / (sw.y - ne.y)) * 100,
  };
}

function markerZ(pin: PinSpec, selected: boolean): number {
  if (selected) return 50;
  return pin.variant === 'result' ? 40 : pin.variant === 'saved' ? 30 : pin.variant === 'default' ? 20 : 10;
}

function PinGlyph({ pin, selected, saved }: { pin: PinSpec; selected: boolean; saved: boolean }) {
  if (pin.variant === 'result') {
    const size = selected ? 42 : 34;
    return (
      <div style={{ paddingBottom: Math.round(size * 0.22) }}>
        <div
          className={styles.glyphResult}
          style={{
            width: size,
            height: size,
            borderRadius: '50% 50% 50% 4px',
            transform: 'rotate(-45deg)',
            boxShadow: selected ? '0 0 0 6px rgba(194,62,34,0.22), 0 4px 10px rgba(23,25,30,0.25)' : undefined,
          }}
        >
          <span className={styles.pinResultLabel}>{pin.label}</span>
        </div>
      </div>
    );
  }

  if (pin.variant === 'saved') {
    const size = selected ? 36 : 28;
    return (
      <div
        className={styles.glyphSaved}
        style={{
          width: size,
          height: size,
          boxShadow: selected ? '0 0 0 6px rgba(23,25,30,0.18), 0 4px 10px rgba(23,25,30,0.25)' : undefined,
        }}
      >
        <span className={styles.pinSavedDot} />
      </div>
    );
  }

  const dim = pin.variant === 'dim';
  const size = selected ? 22 : dim ? 14 : 18;
  return (
    <div
      className={styles.glyphDefault}
      style={{ width: size, height: size, background: dim ? '#B0ACA2' : saved ? '#17191E' : '#C23E22' }}
    />
  );
}
