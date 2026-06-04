"use client";

// Gym social feed (spec §2.3). Members see published posts (newest first,
// pinned at top). The composer lets any active member post an
// announcement or meme; whiteboard linking is a separate coach-only flow
// from the workout day view.

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import Link from "next/link";
import { Settings, ImagePlus, ClipboardList, Megaphone } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useGymContext } from "@/hooks/useGymContext";
import { useActiveMembership } from "@/hooks/useGymContext";
import { useIsFeatureOn } from "@/hooks/useFeatureFlag";
import { useCreateGymPost, useGymPosts } from "@/hooks/useGymPosts";
import { PostCard } from "@/components/gym/post-card";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { BackButton } from "@/components/shared/back-button";

export default function GymSocialPage() {
  const { data: ctx } = useGymContext();
  const activeId = ctx?.activeCommunityId ?? null;
  const membership = useActiveMembership();
  const socialOn = useIsFeatureOn("social_feed");
  const { data, isLoading } = useGymPosts(activeId);
  const create = useCreateGymPost(activeId);
  const [body, setBody] = useState("");
  const [uploading, setUploading] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<
    { kind: string; url: string } | null
  >(null);
  const [linkToWorkout, setLinkToWorkout] = useState(false);

  const canPostWhiteboard = !!(membership?.isAdmin || membership?.isCoach);
  const { data: todayWorkout } = useQuery<{
    workoutId: string | null;
    title: string | null;
    workoutDate: string | null;
  }>({
    queryKey: ["gym", activeId, "today-workout"],
    enabled: !!activeId && canPostWhiteboard,
    queryFn: async () => {
      const res = await fetch(`/api/gym/${activeId}/today-workout`);
      if (!res.ok) return { workoutId: null, title: null, workoutDate: null };
      return res.json();
    },
  });

  if (!activeId) {
    return (
      <p className="text-sm text-muted-foreground">
        Join a gym to see its feed.
      </p>
    );
  }
  if (!socialOn) {
    return (
      <p className="text-sm text-muted-foreground">
        The social feed isn&apos;t turned on for this gym yet.
      </p>
    );
  }

  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await fetch(`/api/gym/${activeId}/posts/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "post",
          ext: file.name.split(".").pop() ?? "jpg",
        }),
      });
      if (!res.ok) throw new Error("Upload URL failed");
      const { signedUrl, publicUrl } = await res.json();
      const upload = await fetch(signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!upload.ok) throw new Error("Upload failed");
      setPendingAttachment({ kind: "image", url: publicUrl });
    } catch (err) {
      console.error(err);
      alert("Photo upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <BackButton fallbackHref="/home" />
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/40">
          <Megaphone className="size-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold leading-tight">Feed</h1>
          <p className="text-xs text-muted-foreground">
            Announcements, whiteboard photos, and gym-wide posts
          </p>
        </div>
        {membership?.isAdmin || membership?.isCoach ? (
          <Link href="/gym/social/review">
            <Button size="sm" variant="outline">
              <Settings className="mr-1 size-4" />
              Review
            </Button>
          </Link>
        ) : null}
      </div>

      <Card>
        <CardContent className="space-y-2 py-3">
          <Textarea
            placeholder="Share something with your gym…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
          />
          {pendingAttachment && (
            <div className="relative">
              <img
                src={pendingAttachment.url}
                alt="attachment"
                className="rounded-md max-h-48 object-cover"
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPendingAttachment(null)}
              >
                Remove
              </Button>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
              <ImagePlus className="size-4" />
              {uploading ? "Uploading…" : "Add photo"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={pickImage}
                disabled={uploading}
              />
            </label>
            {canPostWhiteboard && todayWorkout?.workoutId ? (
              <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
                <ClipboardList className="size-4" />
                <input
                  type="checkbox"
                  checked={linkToWorkout}
                  onChange={(e) => setLinkToWorkout(e.target.checked)}
                />
                Link to today&apos;s WOD
              </label>
            ) : null}
            <Button
              size="sm"
              disabled={
                create.isPending || (!body.trim() && !pendingAttachment)
              }
              onClick={() => {
                const isWhiteboard =
                  linkToWorkout && canPostWhiteboard && !!todayWorkout?.workoutId;
                create.mutate(
                  {
                    kind: isWhiteboard ? "whiteboard" : "announcement",
                    body: body.trim() || undefined,
                    workoutId: isWhiteboard
                      ? todayWorkout!.workoutId!
                      : undefined,
                    workoutDate: isWhiteboard
                      ? todayWorkout!.workoutDate ?? undefined
                      : undefined,
                    attachments: pendingAttachment
                      ? [pendingAttachment]
                      : undefined,
                  },
                  {
                    onSuccess: () => {
                      setBody("");
                      setPendingAttachment(null);
                      setLinkToWorkout(false);
                    },
                  }
                );
              }}
            >
              Post
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading feed…</p>
      ) : !data?.posts.length ? (
        <p className="text-sm text-muted-foreground">No posts yet.</p>
      ) : (
        data.posts.map((p) => (
          <PostCard key={p.id} post={p} communityId={activeId} mode="feed" />
        ))
      )}
    </div>
  );
}
