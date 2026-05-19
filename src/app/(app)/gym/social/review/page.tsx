"use client";

// Coach review queue for pending_review gym posts (e.g. auto-anniversary).
// One-tap approve or edit-and-approve.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useGymContext } from "@/hooks/useGymContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { GymToolHeader } from "@/components/gym/gym-tool-header";
import { Inbox } from "lucide-react";

interface PendingPost {
  id: string;
  kind: string;
  body: string | null;
  authorId: string;
  authorName: string;
  createdAt: string;
}

export default function ReviewQueuePage() {
  const { data: ctx } = useGymContext();
  const activeId = ctx?.activeCommunityId ?? null;
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ posts: PendingPost[] }>({
    queryKey: ["gym", activeId, "social", "review"],
    enabled: !!activeId,
    queryFn: async () => {
      const res = await fetch(`/api/gym/${activeId}/posts/review`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const update = useMutation({
    mutationFn: async ({
      id,
      body,
      status,
    }: {
      id: string;
      body?: string;
      status: string;
    }) => {
      const res = await fetch(`/api/gym-posts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, status }),
      });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["gym", activeId, "social", "review"],
      });
      qc.invalidateQueries({
        queryKey: ["gym", activeId, "social", "feed"],
      });
    },
  });

  if (!activeId) return <p className="text-sm">Pick a gym.</p>;
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!data?.posts.length) {
    return (
      <div className="space-y-3">
        <GymToolHeader
          icon={Inbox}
          label="Review queue"
          description="Auto-generated posts waiting for a coach to approve or discard"
          backHref="/gym/social"
          backLabel="Feed"
        />
        <p className="text-sm text-muted-foreground">Nothing to review.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <GymToolHeader
        icon={Inbox}
        label={`Review queue (${data.posts.length})`}
        description="Auto-generated posts waiting for a coach to approve or discard"
        backHref="/gym/social"
        backLabel="Feed"
      />
      {data.posts.map((p) => (
        <ReviewItem key={p.id} post={p} onSubmit={update.mutate} />
      ))}
    </div>
  );
}

function ReviewItem({
  post,
  onSubmit,
}: {
  post: PendingPost;
  onSubmit: (args: { id: string; body?: string; status: string }) => void;
}) {
  const [body, setBody] = useState(post.body ?? "");
  return (
    <Card>
      <CardContent className="space-y-2 py-3">
        <p className="text-xs text-muted-foreground">
          {post.kind === "auto_anniversary"
            ? "🎉 Anniversary post"
            : post.kind === "auto_birthday"
              ? "🎂 Birthday post"
              : post.kind}{" "}
          · for {post.authorName}
        </p>
        <Textarea
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => onSubmit({ id: post.id, body, status: "published" })}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onSubmit({ id: post.id, status: "deleted" })}
          >
            Discard
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
