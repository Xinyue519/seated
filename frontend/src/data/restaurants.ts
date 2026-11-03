import type { CuisineGroup, Restaurant } from '@/types';

/**
 * Restaurant registry. Filled at login from the API (`bootstrap()`), whether
 * that's the Go backend or the mock API, so components can look restaurants
 * up synchronously by id.
 */
let restaurants: Restaurant[] = [];
let byId: Record<string, Restaurant> = {};

export function setRestaurants(list: Restaurant[]): void {
  restaurants = list;
  byId = Object.fromEntries(list.map((r) => [r.id, r]));
}

export function allRestaurants(): Restaurant[] {
  return restaurants;
}

export function findRestaurant(id: string): Restaurant | undefined {
  return byId[id];
}

export function getRestaurant(id: string): Restaurant {
  const r = byId[id];
  if (!r) throw new Error(`Unknown restaurant: ${id}`);
  return r;
}

/** Static reference data used for map labels and ranking. */
export const NEIGHBORHOODS: Record<string, [lat: number, lng: number]> = {
  'West Village': [40.7362, -74.0062],
  'Greenwich Village': [40.73, -73.9985],
  SoHo: [40.724, -74.003],
  Nolita: [40.7212, -73.994],
  Tribeca: [40.7168, -74.0095],
  'East Village': [40.728, -73.9828],
  'Lower East Side': [40.717, -73.9875],
  Flatiron: [40.7405, -73.9905],
  NoMad: [40.7455, -73.988],
};

export const CUISINE_LABELS: Record<CuisineGroup, string> = {
  unknown: 'Unknown',
  italian: 'Italian',
  pizza: 'Pizza',
  french: 'French',
  japanese: 'Japanese',
  mexican: 'Mexican',
  korean: 'Korean',
  thai: 'Thai',
  deli: 'Deli',
  american: 'New American',
  vegetarian: 'Vegetarian',
  cafe: 'Cafe',
  bakery: 'Bakery',
};
