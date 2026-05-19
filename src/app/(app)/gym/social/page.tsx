"use client";

// Gym social feed (spec §2.3). Members see published posts (newest first,
// pinned at top). The composer lets any active member post an
// announcement or meme; whiteboard linking is a separate coach-only flow
// from the workout day view.

/* eslint-disable @next/next/no-img-element */

import { useRef, useState } from "react";
import Link from "next/link";
import {
  Flame,
  MessageSquare,
  Settings,
  ImagePlus,
  ClipboardList,
  Megaphone,
  Send,
} from "lucide-react";
import { GymToolHeader } from "@/components/gym/gym-tool-header";
import { useQuery } from "@tanstack/react-query";
import { useGymContext } from "@/hooks/useGymContext";
import { useActiveMembership } from "@/hooks/useGymContext";
import { useIsFeatureOn } from "@/hooks/useFeatureFlag";
import {
  useCreateGymPost,
  useCreatePostComment,
  useGymPosts,
  usePostComments,
  useTogglePostReaction,
  type GymPostListItem,
} from "@/hooks/useGymPosts";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

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
      <GymToolHeader
        icon={Megaphone}
        label="Feed"
        description="Announcements, whiteboard photos, and gym-wide posts"
      />
      {membership?.isAdmin || membership?.isCoach ? (
        <div className="flex items-center justify-end">
          <Link href="/gym/social/review">
            <Button size="sm" variant="outline">
              <Settings className="mr-1 size-4" />
              Review queue
            </Button>
          </Link>
        </div>
      ) : null}

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
          <PostCard key={p.id} post={p} communityId={activeId} />
        ))
      )}
    </div>
  );
}

function PostCard({
  post,
  communityId,
}: {
  post: GymPostListItem;
  communityId: string;
}) {
  const toggle = useTogglePostReaction(communityId);
  const [commentsOpen, setCommentsOpen] = useState(false);
  return (
    <Card id={`post-${post.id}`}>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center gap-2">
          {post.author.image ? (
            <img
              src={post.author.image}
              alt=""
              className="size-9 rounded-full object-cover"
            />
          ) : (
            <div className="flex size-9 items-center justify-center rounded-full bg-muted text-xs">
              {post.author.name.slice(0, 1)}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">
              {post.author.name}
              {post.isPinned ? " · 📌" : ""}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {new Date(post.publishedAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
              {post.workoutId ? " · whiteboard" : null}
            </p>
          </div>
        </div>
        {post.body && (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {post.body}
          </p>
        )}
        {post.attachments.map((a) => (
          <img
            key={a.id}
            src={a.url}
            alt="attachment"
            className="w-full rounded-md object-contain"
          />
        ))}
        <div className="flex items-center gap-4 text-xs">
          <button
            type="button"
            onClick={() =>
              toggle.mutate({ postId: post.id, isOn: post.viewerReacted })
            }
            className={`inline-flex items-center gap-1 ${
              post.viewerReacted
                ? "text-orange-500"
                : "text-muted-foreground"
            }`}
          >
            <Flame className="size-4" /> {post.reactionCount}
          </button>
          <button
            type="button"
            onClick={() => setCommentsOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-muted-foreground"
          >
            <MessageSquare className="size-4" /> {post.commentCount}
          </button>
        </div>
        {commentsOpen ? (
          <InlineComments postId={post.id} communityId={communityId} />
        ) : null}
      </CardContent>
    </Card>
  );
}

interface CommentItem {
  id: string;
  body: string;
  createdAt: string;
  userId: string;
  userName: string;
  userImage: string | null;
}

function InlineComments({
  postId,
  communityId,
}: {
  postId: string;
  communityId: string;
}) {
  const { data, isLoading } = usePostComments(postId);
  const create = useCreatePostComment(postId, communityId);
  const [body, setBody] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  return (
    <div className="space-y-2 border-t border-border/40 pt-3">
      {isLoading ? (
        <p className="text-[11px] text-muted-foreground">Loading comments…</p>
      ) : !data?.comments?.length ? (
        <p className="text-[11px] text-muted-foreground">
          No comments yet — be the first.
        </p>
      ) : (
        <div className="space-y-2">
          {(data.comments as CommentItem[]).map((c) => (
            <div key={c.id} className="flex items-start gap-2">
              {c.userImage ? (
                <img
                  src={c.userImage}
                  alt=""
                  className="size-7 rounded-full object-cover"
                />
              ) : (
                <div className="flex size-7 items-center justify-center rounded-full bg-muted text-[10px]">
                  {c.userName.slice(0, 1)}
                </div>
              )}
              <div className="flex-1 min-w-0 rounded-md bg-muted/30 px-3 py-2">
                <p className="text-[11px] font-medium">{c.userName}</p>
                <p className="whitespace-pre-wrap text-sm">{c.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-start gap-2 pt-1">
        <Textarea
          ref={textareaRef}
          placeholder="Write a comment…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={1}
          className="min-h-9 resize-none text-sm"
        />
        <Button
          size="sm"
          disabled={create.isPending || !body.trim()}
          onClick={() =>
            create.mutate(body.trim(), {
              onSuccess: () => {
                setBody("");
                textareaRef.current?.focus();
              },
            })
          }
        >
          <Send className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
