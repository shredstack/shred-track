"use client";

// Gym post detail. Renders the post itself at the top so the reader has
// context, then the existing comments thread (read + composer) below.

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { useParams } from "next/navigation";
import {
  useCreatePostComment,
  useGymPost,
  usePostComments,
} from "@/hooks/useGymPosts";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { GymToolHeader } from "@/components/gym/gym-tool-header";
import { PostCard } from "@/components/gym/post-card";
import { Loader2, MessageSquare } from "lucide-react";

interface Comment {
  id: string;
  body: string;
  createdAt: string;
  userId: string;
  userName: string;
  userImage: string | null;
}

export default function GymPostPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const post = useGymPost(id);
  const comments = usePostComments(id);
  const create = useCreatePostComment(id, post.data?.communityId ?? null);
  const [body, setBody] = useState("");

  return (
    <div className="space-y-4">
      <GymToolHeader
        icon={MessageSquare}
        label="Post"
        backHref="/gym/social"
        backLabel="Feed"
      />

      {post.isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : post.error ? (
        <p className="py-6 text-center text-sm text-destructive">
          {(post.error as Error).message}
        </p>
      ) : post.data ? (
        <PostCard
          post={post.data}
          communityId={post.data.communityId}
          mode="detail"
        />
      ) : null}

      <Card>
        <CardContent className="space-y-2 py-3">
          <Textarea
            placeholder="Write a comment…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
          />
          <Button
            size="sm"
            disabled={create.isPending || !body.trim()}
            onClick={() =>
              create.mutate(body.trim(), {
                onSuccess: () => setBody(""),
              })
            }
          >
            Post comment
          </Button>
        </CardContent>
      </Card>
      {comments.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !comments.data?.comments?.length ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      ) : (
        (comments.data.comments as Comment[]).map((c) => (
          <Card key={c.id}>
            <CardContent className="flex items-start gap-3 py-3">
              {c.userImage ? (
                <img
                  src={c.userImage}
                  alt=""
                  className="size-8 rounded-full object-cover"
                />
              ) : (
                <div className="flex size-8 items-center justify-center rounded-full bg-muted text-xs">
                  {c.userName.slice(0, 1)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium">{c.userName}</p>
                <p className="whitespace-pre-wrap text-sm">{c.body}</p>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
