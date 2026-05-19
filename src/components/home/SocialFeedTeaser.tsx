import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export interface SocialFeedTeaserPost {
  id: string;
  kind: string;
  authorName: string;
  body: string | null;
  publishedAt: string; // ISO
}

export function SocialFeedTeaser({ posts }: { posts: SocialFeedTeaserPost[] }) {
  if (!posts.length) return null;
  return (
    <Card>
      <CardContent className="space-y-3 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">From your gym</span>
          </div>
          <Link
            href="/gym/social"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            See all
          </Link>
        </div>
        <div className="space-y-2">
          {posts.slice(0, 3).map((p) => (
            <Link
              key={p.id}
              href={`/gym/social#post-${p.id}`}
              className="block rounded-lg border border-white/[0.06] bg-white/[0.02] p-2 transition-colors hover:bg-white/[0.06]"
            >
              <p className="text-xs font-medium">{p.authorName}</p>
              {p.body ? (
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {p.body}
                </p>
              ) : (
                <p className="text-xs italic text-muted-foreground/70">
                  {p.kind === "whiteboard" ? "Posted a whiteboard photo." : "—"}
                </p>
              )}
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
