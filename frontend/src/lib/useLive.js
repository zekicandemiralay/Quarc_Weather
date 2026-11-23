import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';

/**
 * Re-renders with the result of a local-database query whenever the data it read changes — including when the
 * sync engine merges in another device's edit, so the screen updates on its own.
 *
 *   const cities = useLive(() => cityStore.listCities(), [], []);
 */
export function useLive(query, deps = [], initial = undefined) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    const sub = liveQuery(query).subscribe({ next: setValue, error: () => {} });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}
