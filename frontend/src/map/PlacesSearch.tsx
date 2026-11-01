import { useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { allRestaurants } from '@/data/restaurants';
import { useApp } from '@/store/AppStore';
import { SearchIcon, CloseIcon } from '@/components/icons';
import styles from './map.module.css';

const NYC_CENTER = { lat: 40.735, lng: -73.995 };

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Loose match against our curated 21 — Google doesn't know which restaurants we book. */
function matchRestaurant(name: string) {
  const n = normalize(name);
  if (!n) return undefined;
  return allRestaurants().find((r) => {
    const rn = normalize(r.name);
    return rn === n || rn.includes(n) || n.includes(rn);
  });
}

/**
 * Google-powered restaurant search (Places Autocomplete, New API). Renders nothing
 * when the Places library isn't available — i.e. no Google Maps key configured, or
 * the map fell back to the drawn placeholder.
 */
export default function PlacesSearch() {
  const placesLib = useMapsLibrary('places');
  const { store, toast } = useApp();
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
        includedPrimaryTypes: ['restaurant'],
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

  const selectSuggestion = (s: google.maps.places.AutocompleteSuggestion) => {
    const prediction = s.placePrediction;
    if (!prediction) return;
    setQuery(prediction.text.text);
    setOpen(false);
    setSuggestions([]);
    prediction
      .toPlace()
      .fetchFields({ fields: ['displayName', 'id'] })
      .then(({ place }) => {
        sessionToken.current = null; // session ends once a selection is fetched
        const name = place.displayName ?? prediction.text.text;
        const match = matchRestaurant(name);
        if (match) {
          store.set({ selectedId: match.id, mapFilter: [match.id] });
        } else {
          toast(`Ask Seated doesn't have "${name}" yet.`);
        }
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
                  // Fires before the input's onBlur closes the dropdown.
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
