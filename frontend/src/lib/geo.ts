/**
 * Projection for the stylized downtown Manhattan map.
 * Swap this out (along with MapView's background) when moving to Google Maps.
 */
const LNG_WEST = -74.0165;
const LNG_SPAN = 0.0345;
const LAT_NORTH = 40.7485;
const LAT_SPAN = 0.0335;

export interface Point {
  x: number; // percent of map width
  y: number; // percent of map height
}

export function project(lat: number, lng: number): Point {
  return {
    x: Math.max(3, Math.min(97, ((lng - LNG_WEST) / LNG_SPAN) * 100)),
    y: Math.max(8, Math.min(96, ((LAT_NORTH - lat) / LAT_SPAN) * 100)),
  };
}

export function distance(a: [number, number], b: [number, number]): number {
  const dLat = a[0] - b[0];
  const dLng = a[1] - b[1];
  return Math.sqrt(dLat * dLat + dLng * dLng);
}
