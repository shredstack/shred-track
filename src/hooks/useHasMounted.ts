"use client";

import { useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// useHasMounted — returns false during SSR and the first client render, then
// true after the component mounts.
//
// Use it to gate UI that depends on client-only state which the server can't
// see — most notably the persisted React Query cache (restored from
// localStorage by PersistQueryClientProvider). Reading that cache during the
// first client render produces output the server never rendered, which React
// reports as a hydration mismatch and recovers from by throwing away the SSR
// tree. Gating on this hook makes the first client render match the server,
// then swaps in the real UI right after mount.
//
// Implemented with useSyncExternalStore (mirroring useStickyTab / useUnits) so
// the server snapshot is `false` and the client switches to `true` after
// hydration — no setState-in-effect, no hydration warning.
// ---------------------------------------------------------------------------

// The "store" never changes after mount, so subscribe is a no-op.
const subscribe = () => () => {};

export function useHasMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true, // client snapshot
    () => false, // server snapshot (and first hydration render)
  );
}
