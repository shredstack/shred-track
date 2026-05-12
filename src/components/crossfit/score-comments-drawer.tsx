"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Loader2, Send, Trash2, User } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  useCreateComment,
  useDeleteComment,
  useMentionSearch,
  useScoreComments,
} from "@/hooks/useComments";
import { tokenizeBody, mentionsMatch } from "@/lib/social/mentions";
import type { CommentDisplay, MentionMember } from "@/types/social";

// NOTE: emoji-mart picker is deferred to a follow-up commit per the spec.
// The textarea accepts native emoji input from the system keyboard
// (Cmd+Ctrl+Space on Mac, Win+. on Windows, system emoji key on mobile),
// so users have full Unicode emoji access today — the picker is a
// nice-to-have UI affordance, not a blocker.

interface ScoreCommentsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scoreId: string | null;
  workoutId: string;
  communityId: string;
  athleteName?: string;
  workoutTitle?: string;
}

function relativeTime(iso: string): string {
  const diffSec = Math.max(
    1,
    Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  );
  if (diffSec < 60) return "just now";
  const m = Math.round(diffSec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function CommentBody({ comment }: { comment: CommentDisplay }) {
  const mentionMap = useMemo(
    () => new Map(comment.mentions.map((m) => [m.userId, m])),
    [comment.mentions]
  );
  const segments = tokenizeBody(comment.body);
  return (
    <p className="whitespace-pre-wrap text-sm leading-snug">
      {segments.map((seg, idx) => {
        if (seg.kind === "text") {
          return <span key={idx}>{seg.text}</span>;
        }
        const mention = mentionMap.get(seg.userId);
        const label = mention?.username
          ? `@${mention.username}`
          : mention
          ? `@${mention.name}`
          : "@user";
        return (
          <span
            key={idx}
            className="rounded bg-primary/10 px-1 text-primary"
          >
            {label}
          </span>
        );
      })}
    </p>
  );
}

function CommentRow({
  comment,
  scoreId,
  workoutId,
}: {
  comment: CommentDisplay;
  scoreId: string;
  workoutId: string;
}) {
  const deleteComment = useDeleteComment();
  return (
    <div className="flex gap-2 px-1 py-2">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
        {comment.userImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={comment.userImage}
            alt={comment.userName}
            className="size-full object-cover"
          />
        ) : (
          <User className="size-3.5 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-xs">
          <span className="font-medium">{comment.userName}</span>
          {comment.userUsername && (
            <span className="text-muted-foreground">
              @{comment.userUsername}
            </span>
          )}
          <span className="text-muted-foreground">
            · {relativeTime(comment.createdAt)}
            {comment.isEdited && " (edited)"}
          </span>
        </div>
        <div className="mt-0.5">
          <CommentBody comment={comment} />
        </div>
      </div>
      {comment.isOwn && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 self-start text-muted-foreground hover:text-destructive"
          disabled={deleteComment.isPending}
          onClick={() =>
            deleteComment.mutate({
              scoreId,
              workoutId,
              commentId: comment.id,
            })
          }
          aria-label="Delete comment"
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

// CommentInput
//
// Maintains its own "body draft" and parallel list of mention chips. When
// the user types `@`, we track the trigger position and the partial token
// after it; the popover below shows matching members and inserting one
// replaces the partial token with `[mention:<userId>]`. The visible body
// in the textarea shows the raw token text — we don't (yet) render styled
// chips inside the textarea, which simplifies the cursor model. Mentions
// are still rendered as styled chips in the *posted* comment.

function CommentInput({
  scoreId,
  workoutId,
  communityId,
  onPosted,
}: {
  scoreId: string;
  workoutId: string;
  communityId: string;
  onPosted: () => void;
}) {
  const [body, setBody] = useState("");
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(mentionQuery ?? "", 150);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const createComment = useCreateComment();

  const { data: searchData } = useMentionSearch(
    mentionQuery !== null ? communityId : null,
    debouncedQuery,
    { enabled: mentionQuery !== null }
  );

  const detectMentionTrigger = useCallback(
    (text: string, cursor: number) => {
      // Walk backward from the cursor looking for `@` preceded by start-of-
      // string or whitespace. Stop at whitespace mid-token.
      let start = cursor - 1;
      while (start >= 0) {
        const ch = text[start];
        if (ch === "@") {
          if (start === 0 || /\s/.test(text[start - 1])) {
            return { start, query: text.slice(start + 1, cursor) };
          }
          break;
        }
        if (/\s/.test(ch)) break;
        start -= 1;
      }
      return null;
    },
    []
  );

  const handleBodyChange = useCallback(
    (next: string) => {
      setBody(next);
      const cursor = textareaRef.current?.selectionStart ?? next.length;
      const trigger = detectMentionTrigger(next, cursor);
      setMentionQuery(trigger ? trigger.query : null);
    },
    [detectMentionTrigger]
  );

  const insertMention = useCallback(
    (member: MentionMember) => {
      const el = textareaRef.current;
      const cursor = el?.selectionStart ?? body.length;
      const trigger = detectMentionTrigger(body, cursor);
      if (!trigger) return;
      const token = `[mention:${member.userId}]`;
      const before = body.slice(0, trigger.start);
      const after = body.slice(cursor);
      // Pad the token with a trailing space so the cursor lands cleanly
      // and the next character isn't merged into the chip.
      const next = `${before}${token} ${after}`;
      setBody(next);
      setMentionedUserIds((prev) =>
        prev.includes(member.userId) ? prev : [...prev, member.userId]
      );
      setMentionQuery(null);
      // Restore focus and place cursor after the inserted token.
      requestAnimationFrame(() => {
        const newCursor = before.length + token.length + 1;
        el?.focus();
        el?.setSelectionRange(newCursor, newCursor);
      });
    },
    [body, detectMentionTrigger]
  );

  const cleanMentionIds = useMemo(() => {
    // Drop any ids whose token no longer appears in the body — user typed
    // an @x and then deleted it. mentionsMatch needs the lists to align
    // exactly, so we filter here on every render.
    const set = new Set<string>();
    for (const m of body.matchAll(/\[mention:([0-9a-f-]{36})\]/gi)) {
      set.add(m[1].toLowerCase());
    }
    return mentionedUserIds.filter((id) => set.has(id.toLowerCase()));
  }, [body, mentionedUserIds]);

  const canSubmit =
    body.trim().length > 0 &&
    !createComment.isPending &&
    mentionsMatch(body, cleanMentionIds);

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    createComment.mutate(
      {
        scoreId,
        workoutId,
        body: body.trimEnd(),
        mentionedUserIds: cleanMentionIds,
      },
      {
        onSuccess: () => {
          setBody("");
          setMentionedUserIds([]);
          setMentionQuery(null);
          onPosted();
        },
      }
    );
  }, [
    canSubmit,
    createComment,
    scoreId,
    workoutId,
    body,
    cleanMentionIds,
    onPosted,
  ]);

  return (
    <div className="border-t border-border/40 bg-background p-3">
      {mentionQuery !== null && searchData?.members && searchData.members.length > 0 && (
        <div className="mb-2 max-h-40 overflow-y-auto rounded-md border border-border/60 bg-popover shadow-sm">
          {searchData.members.map((m) => (
            <button
              key={m.userId}
              type="button"
              onClick={() => insertMention(m)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
            >
              <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
                <User className="size-3 text-muted-foreground" />
              </div>
              <span className="truncate">{m.name}</span>
              {m.username && (
                <span className="truncate text-xs text-muted-foreground">
                  @{m.username}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => handleBodyChange(e.target.value)}
          onSelect={(e) => {
            const cursor = (e.target as HTMLTextAreaElement).selectionStart;
            const trigger = detectMentionTrigger(body, cursor);
            setMentionQuery(trigger ? trigger.query : null);
          }}
          placeholder="Add a comment… type @ to mention"
          className="min-h-9 resize-none"
          rows={2}
        />
        <Button
          type="button"
          size="icon-sm"
          onClick={handleSubmit}
          disabled={!canSubmit}
          aria-label="Post comment"
        >
          {createComment.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </Button>
      </div>
      {createComment.error && (
        <p className="mt-1 text-xs text-destructive">
          {(createComment.error as Error).message}
        </p>
      )}
    </div>
  );
}

export function ScoreCommentsDrawer({
  open,
  onOpenChange,
  scoreId,
  workoutId,
  communityId,
  athleteName,
  workoutTitle,
}: ScoreCommentsDrawerProps) {
  const { data, isLoading, error } = useScoreComments(scoreId, {
    enabled: open && !!scoreId,
  });
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll to the bottom when a new comment lands or the drawer opens.
  useEffect(() => {
    if (!open || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open, data?.comments.length]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden data-[side=bottom]:rounded-t-2xl p-0"
      >
        <SheetHeader className="border-b border-border/40">
          <SheetTitle className="text-sm">
            {athleteName
              ? `${athleteName}${workoutTitle ? ` · ${workoutTitle}` : ""}`
              : "Comments"}
          </SheetTitle>
        </SheetHeader>
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto px-3 py-2"
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="py-6 text-center text-sm text-destructive">
              {(error as Error).message}
            </p>
          ) : !data || data.comments.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No comments yet. Be the first to chime in.
            </p>
          ) : (
            data.comments.map((c) => (
              <CommentRow
                key={c.id}
                comment={c}
                scoreId={scoreId!}
                workoutId={workoutId}
              />
            ))
          )}
        </div>
        {scoreId && (
          <CommentInput
            scoreId={scoreId}
            workoutId={workoutId}
            communityId={communityId}
            onPosted={() => {
              // Scroll happens via the effect when data changes.
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
