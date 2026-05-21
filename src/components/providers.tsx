"use client";

import { useEffect, useState } from "react";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import {
  PersistQueryClientProvider,
  removeOldestQuery,
} from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { NativeBootstrap } from "@/lib/native/bootstrap";
import { Toaster } from "@/components/ui/sonner";
import { ApiError } from "@/lib/api-fetch";
import { createClient } from "@/lib/supabase/client";

// localStorage key for the persisted React Query cache.
const CACHE_STORAGE_KEY = "shredtrack-query-cache";

// Bump when a release changes cached data shapes so users never hydrate stale,
// incompatible data after an update.
const CACHE_BUSTER = "v1";

// Keep cached data for 24h. Persistence is what lets previously-loaded data
// (workouts, races) appear instantly — and survive a flaky connection — on the
// next app open instead of every screen starting from a cold network request.
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        // gcTime must be >= the persister's maxAge, otherwise restored queries
        // get garbage-collected before they can be used.
        gcTime: CACHE_MAX_AGE_MS,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Client errors (auth, validation, not-found) won't fix themselves —
          // retrying just delays the error state. Network/timeout/5xx errors
          // are transient, so retry a bounded number of times.
          if (
            error instanceof ApiError &&
            error.status >= 400 &&
            error.status < 500
          ) {
            return false;
          }
          return failureCount < 2;
        },
      },
    },
  });
}

/**
 * Clears the cache when the user signs out so the next account to sign in on
 * this device (e.g. a shared family device) never sees the previous user's
 * persisted data.
 */
function QueryCacheAuthGuard({
  persister,
}: {
  persister: ReturnType<typeof createSyncStoragePersister>;
}) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        queryClient.clear();
        void persister.removeClient();
      }
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient, persister]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  const [persister] = useState(() =>
    createSyncStoragePersister({
      // `window` is undefined during SSR — the persister no-ops without storage.
      storage: typeof window !== "undefined" ? window.localStorage : undefined,
      key: CACHE_STORAGE_KEY,
      // If localStorage is full, drop the oldest queries and retry rather than
      // failing the whole write.
      retry: removeOldestQuery,
    }),
  );

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: CACHE_MAX_AGE_MS,
        buster: CACHE_BUSTER,
      }}
    >
      <QueryCacheAuthGuard persister={persister} />
      <NativeBootstrap />
      {children}
      <Toaster richColors position="top-center" />
    </PersistQueryClientProvider>
  );
}
