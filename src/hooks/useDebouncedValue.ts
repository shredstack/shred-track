import { useEffect, useState } from "react";

/**
 * Returns `value` delayed by `ms` milliseconds. Each new value cancels the
 * pending update — handy for search inputs where every keystroke shouldn't
 * trigger a server request.
 */
export function useDebouncedValue<T>(value: T, ms: number = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}
