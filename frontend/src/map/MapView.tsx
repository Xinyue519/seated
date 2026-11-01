import { useEffect, useState } from 'react';
import { config } from '@/config';
import GoogleMapView from './GoogleMapView';
import PlaceholderMapView, { type MapViewProps } from './PlaceholderMapView';

export type { PinSpec, PinVariant, MapViewProps } from './PlaceholderMapView';

/**
 * Real Google map when VITE_GOOGLE_MAPS_API_KEY is set, otherwise (or if Google
 * rejects the key) the drawn placeholder so the app still runs without a key.
 */
export default function MapView(props: MapViewProps) {
  const [authFailed, setAuthFailed] = useState(false);

  useEffect(() => {
    if (!config.googleMapsApiKey) return;
    const w = window as unknown as { gm_authFailure?: () => void };
    w.gm_authFailure = () => {
      console.error('Google Maps rejected the API key (check key restrictions and billing). Using the placeholder map.');
      setAuthFailed(true);
    };
    return () => {
      delete w.gm_authFailure;
    };
  }, []);

  if (!config.googleMapsApiKey || authFailed) return <PlaceholderMapView {...props} />;
  return <GoogleMapView {...props} />;
}
