import Link from "next/link";
import { ArrowRight, MessageSquare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export interface SocialFeedTeaserPost {
  id: string;
  kind: string;
  authorName: string;
  body: string | null;
  publishedAt: string; // ISO
}

/**
 * Always-visible gym-scoped CTA on Home. When there are posts, surfaces the
 * most recent as a preview; otherwise just prompts the user to open the
 * feed. The full feed lives at /gym/social.
 */
export function SocialFeedTeaser({ posts }: { posts: SocialFeedTeaserPost[] }) {
  const recent = posts[0];
  return (
    <Link href="/gym/social" className="block">
      <Card className="hover:bg-muted/30 transition-colors">
        <CardContent className="space-y-2 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MessageSquare className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">Gym feed</span>
            </div>
            <ArrowRight className="size-4 text-muted-foreground" />
          </div>
          {recent ? (
            <div className="rounded-md border border-white/[0.06] bg-white/[0.02] p-2">
              <p className="text-xs font-medium">{recent.authorName}</p>
              {recent.body ? (
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {recent.body}
                </p>
              ) : (
                <p className="text-xs italic text-muted-foreground/70">
                  {recent.kind === "whiteboard"
                    ? "Posted a whiteboard photo."
                    : "Posted an attachment."}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              See announcements, whiteboards, and gym chatter.
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
