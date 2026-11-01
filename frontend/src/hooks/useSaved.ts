import { useCallback } from 'react';
import { findRestaurant } from '@/data/restaurants';
import { useApp } from '@/store/AppStore';

/** Optimistically save/unsave a restaurant, rolling back if the API call fails. */
export function useToggleSaved() {
  const { api, store, toast } = useApp();

  return useCallback(
    async (restaurantId: string) => {
      const wasSaved = store.get().saved.includes(restaurantId);
      const name = findRestaurant(restaurantId)?.name ?? 'Restaurant';
      const apply = (saved: boolean) =>
        store.set((s) => ({
          saved: saved ? [...s.saved.filter((id) => id !== restaurantId), restaurantId] : s.saved.filter((id) => id !== restaurantId),
        }));

      apply(!wasSaved);
      toast(wasSaved ? `${name} removed from saved` : `${name} saved`);
      try {
        await api.setSaved(restaurantId, !wasSaved);
      } catch {
        apply(wasSaved);
        toast(`Couldn't update saved places. Try again.`);
      }
    },
    [api, store, toast],
  );
}
