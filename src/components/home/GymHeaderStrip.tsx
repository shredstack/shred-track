/* eslint-disable @next/next/no-img-element */

import { Globe } from "lucide-react";

export interface GymHeaderStripData {
  name: string;
  logoUrl: string | null;
  pinnedAnnouncement: string | null;
  websiteUrl: string | null;
}

export function GymHeaderStrip({
  data,
}: {
  data: GymHeaderStripData | null;
}) {
  if (!data) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      {data.logoUrl ? (
        <img
          src={data.logoUrl}
          alt={data.name}
          className="size-8 rounded-md object-cover"
        />
      ) : (
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/15 text-xs font-bold text-primary">
          {data.name.slice(0, 2).toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{data.name}</p>
        {data.pinnedAnnouncement ? (
          <p className="line-clamp-1 text-xs text-muted-foreground">
            📌 {data.pinnedAnnouncement}
          </p>
        ) : null}
      </div>
      {data.websiteUrl ? (
        <a
          href={data.websiteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
          aria-label={`Visit ${data.name} website`}
        >
          <Globe className="h-4 w-4" />
        </a>
      ) : null}
    </div>
  );
}
