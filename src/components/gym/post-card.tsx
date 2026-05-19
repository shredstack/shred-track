"use client";

// Shared gym social post card. Used by:
//   - the feed (mode="feed"): the header/body/attachments are a tap target
//     that links to /gym/social/<id>, and the comment button toggles an
//     inline thread + composer.
//   - the post detail page (mode="detail"): no link wrap (we're already
//     on the detail page), and the comment button is a non-interactive
//     counter — the dedicated comments thread on the detail page handles
//     reading/composing.

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useRef, useState } from "react";
import { Flame, MessageSquare, Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  useCreatePostComment,
  usePostComments,
  useTogglePostReaction,
  type GymPostListItem,
} from "@/hooks/useGymPosts";

export type PostCardMode = "feed" | "detail";

export function PostCard({
  post,
  communityId,
  mode,
}: {
  post: GymPostListItem;
  communityId: string;
  mode: PostCardMode;
}) {
  const toggle = useTogglePostReaction(communityId);
  const [commentsOpen, setCommentsOpen] = useState(false);

  const headerBody = (
    <>
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
    </>
  );

  return (
    <Card id={`post-${post.id}`}>
      <CardContent className="space-y-3 py-4">
        {mode === "feed" ? (
          <Link
            href={`/gym/social/${post.id}`}
            className="block space-y-3 -m-2 p-2 rounded-md hover:bg-muted/30 active:bg-muted/40 transition-colors"
          >
            {headerBody}
          </Link>
        ) : (
          <div className="space-y-3">{headerBody}</div>
        )}
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
          {mode === "feed" ? (
            <button
              type="button"
              onClick={() => setCommentsOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-muted-foreground"
            >
              <MessageSquare className="size-4" /> {post.commentCount}
            </button>
          ) : (
            // On the detail page the dedicated comments thread sits below
            // this card — the counter stays as a read-only indicator.
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <MessageSquare className="size-4" /> {post.commentCount}
            </span>
          )}
        </div>
        {mode === "feed" && commentsOpen ? (
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
