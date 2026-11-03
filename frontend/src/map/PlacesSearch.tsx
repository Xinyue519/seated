import { useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { useApp } from '@/store/AppStore';
import { SearchIcon, CloseIcon } from '@/components/icons';
import styles from './map.module.css';
import { PRICE_MAP, CUISINE_MAP, NYC_CENTER, type Restaurant } from '@/types';

function placeToRestaurant(place: google.maps.places.Place): Restaurant {
  const cuisineType = place.types?.find((t) => t in CUISINE_MAP);
  const group = cuisineType ? CUISINE_MAP[cuisineType] : 'unknown';
  const neighborhood =
    place.addressComponents?.find((c) => c.types.includes('neighborhood'))?.longText ?? 'New York';

  return {
    id: place.id,
    name: place.displayName ?? 'Unknown',
    cuisine: group,
    group,
    neighborhood,
    priceLevel: place.priceLevel ? PRICE_MAP[place.priceLevel] ?? 2 : 2,
    lat: place.location?.lat() ?? 0,
    lng: place.location?.lng() ?? 0,
    tags: [],
    description: place.editorialSummary ?? '',
    website: place.websiteURI ?? undefined,
    imageUrl: place.photos?.[0]?.getURI({ maxWidth: 800 }),
  };
}

export default function PlacesSearch() {
  const placesLib = useMapsLibrary('places');
  const { state, store, toast, api, refreshRestaurants } = useApp();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const sessionToken = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!placesLib || query.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      if (!sessionToken.current) sessionToken.current = new placesLib.AutocompleteSessionToken();
      placesLib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: query,
        includedPrimaryTypes: ['restaurant', 'cafe', 'bakery', 'bar'],
        locationBias: { center: NYC_CENTER, radius: 15000 },
        sessionToken: sessionToken.current,
      })
        .then(({ suggestions: results }) => {
          setSuggestions(results);
          setOpen(true);
        })
        .catch(() => setSuggestions([]));
    }, 250);
    return () => window.clearTimeout(debounceRef.current);
  }, [placesLib, query]);

  if (!placesLib) return null;

  const matchRestaurant = async (restaurant: Restaurant): Promise<Restaurant> => {
    const existing = state.restaurants.find((r) => r.id === restaurant.id);
    if (existing) return existing;

    await api.upsertRestaurant(restaurant);
    const list = await refreshRestaurants();
    return list.find((r) => r.id === restaurant.id) ?? restaurant;
  };

  const selectSuggestion = (s: google.maps.places.AutocompleteSuggestion) => {
    const prediction = s.placePrediction;
    if (!prediction) return;
    setQuery(prediction.text.text);
    setOpen(false);
    setSuggestions([]);
    prediction
      .toPlace()
      .fetchFields({ fields: ['*'] })
      .then(async ({ place }) => {
        sessionToken.current = null; // session ends once a selection is fetched
        const restaurant = placeToRestaurant(place);
        const match = await matchRestaurant(restaurant);
        store.set({ selectedId: match.id, mapFilter: [match.id] });
      })
      .catch(() => toast('Could not look up that place.'));
  };

  return (
    <div className={styles.searchBox}>
      <SearchIcon size={15} className={styles.searchIcon} />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        placeholder="Search NYC restaurants…"
        aria-label="Search restaurants"
        className={styles.searchInput}
      />
      {query && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setQuery('');
            setSuggestions([]);
          }}
          className={styles.searchClear}
        >
          <CloseIcon size={12} />
        </button>
      )}
      {open && suggestions.length > 0 && (
        <ul className={styles.searchDropdown}>
          {suggestions.map((s, i) => {
            const p = s.placePrediction;
            if (!p) return null;
            return (
              <li key={p.placeId || i}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectSuggestion(s)}
                  className={styles.searchSuggestion}
                >
                  <span className={styles.searchSuggestionMain}>{(p.mainText ?? p.text).text}</span>
                  {p.secondaryText && <span className={styles.searchSuggestionSecondary}>{p.secondaryText.text}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
