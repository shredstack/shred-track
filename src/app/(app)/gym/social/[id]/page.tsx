"use client";

// Gym post detail with comments thread.

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { useParams } from "next/navigation";
import { useCreatePostComment, usePostComments } from "@/hooks/useGymPosts";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

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
  const { data, isLoading } = usePostComments(id);
  const create = useCreatePostComment(id);
  const [body, setBody] = useState("");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Comments</h1>
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
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data?.comments?.length ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      ) : (
        (data.comments as Comment[]).map((c) => (
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
