"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
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
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  useCreateComment,
  useDeleteComment,
  useMentionSearch,
  useScoreComments,
} from "@/hooks/useComments";
import { tokenizeBody } from "@/lib/social/mentions";
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

// MentionEditor
//
// contentEditable input that renders @mentions as inline chips so the user
// sees `@sarah` instead of `[mention:<uuid>]` while typing. The element is
// uncontrolled — React never re-renders its children; the editor owns its
// DOM. Parent receives serialized state via `onChange` and drives clearing
// or mention insertion through the imperative handle.
//
// Each chip is `<span data-mention-id="…" contenteditable="false">@name</span>`,
// which most browsers treat as atomic for cursor + backspace.

interface MentionEditorHandle {
  clear: () => void;
  insertMention: (member: MentionMember) => void;
  focus: () => void;
}

interface MentionEditorState {
  body: string;
  mentionedUserIds: string[];
  isEmpty: boolean;
  mentionQuery: string | null;
}

interface MentionEditorProps {
  onChange: (state: MentionEditorState) => void;
  placeholder: string;
}

const MENTION_CHIP_CLASS =
  "rounded bg-primary/10 px-1 text-primary";

const MentionEditor = forwardRef<MentionEditorHandle, MentionEditorProps>(
  function MentionEditor({ onChange, placeholder }, ref) {
    const editorRef = useRef<HTMLDivElement>(null);
    const [isEmpty, setIsEmpty] = useState(true);

    const serialize = useCallback((): {
      body: string;
      mentionedUserIds: string[];
    } => {
      const el = editorRef.current;
      if (!el) return { body: "", mentionedUserIds: [] };
      let body = "";
      const ids: string[] = [];
      const walk = (node: Node, isRootChild: boolean) => {
        if (node.nodeType === Node.TEXT_NODE) {
          body += node.textContent ?? "";
          return;
        }
        if (!(node instanceof HTMLElement)) return;
        if (node.dataset.mentionId) {
          body += `[mention:${node.dataset.mentionId}]`;
          ids.push(node.dataset.mentionId);
          return;
        }
        if (node.nodeName === "BR") {
          body += "\n";
          return;
        }
        // Some browsers wrap soft-line-breaks in <div>; treat each non-first
        // root-level <div> as a line break.
        if (
          node.nodeName === "DIV" &&
          isRootChild &&
          body.length > 0 &&
          !body.endsWith("\n")
        ) {
          body += "\n";
        }
        node.childNodes.forEach((child) => walk(child, false));
      };
      el.childNodes.forEach((child) => walk(child, true));
      return { body, mentionedUserIds: ids };
    }, []);

    // Plaintext from editor start up to caret. Mention chips contribute a
    // single space so the `@` inside a chip never registers as a new trigger.
    const textBeforeCaret = useCallback((): string => {
      const sel = typeof window !== "undefined" ? window.getSelection() : null;
      const el = editorRef.current;
      if (!sel || sel.rangeCount === 0 || !el) return "";
      const range = sel.getRangeAt(0);
      if (!range.collapsed) return "";
      if (!el.contains(range.endContainer)) return "";

      let text = "";
      let stopped = false;
      const visit = (node: Node) => {
        if (stopped) return;
        if (node === range.endContainer) {
          if (node.nodeType === Node.TEXT_NODE) {
            text += (node.textContent ?? "").slice(0, range.endOffset);
          } else {
            for (let i = 0; i < range.endOffset && !stopped; i++) {
              visit(node.childNodes[i]);
            }
          }
          stopped = true;
          return;
        }
        if (node.nodeType === Node.TEXT_NODE) {
          text += node.textContent ?? "";
          return;
        }
        if (!(node instanceof HTMLElement)) return;
        if (node.dataset.mentionId) {
          text += " ";
          return;
        }
        if (node.nodeName === "BR") {
          text += "\n";
          return;
        }
        node.childNodes.forEach(visit);
      };
      el.childNodes.forEach(visit);
      return text;
    }, []);

    const detectTrigger = useCallback((): string | null => {
      const text = textBeforeCaret();
      let i = text.length - 1;
      while (i >= 0) {
        const ch = text[i];
        if (ch === "@") {
          if (i === 0 || /\s/.test(text[i - 1])) {
            return text.slice(i + 1);
          }
          return null;
        }
        if (/\s/.test(ch)) return null;
        i -= 1;
      }
      return null;
    }, [textBeforeCaret]);

    const fireChange = useCallback(() => {
      const { body, mentionedUserIds } = serialize();
      const empty = body.trim().length === 0;
      setIsEmpty(empty);
      onChange({
        body,
        mentionedUserIds,
        isEmpty: empty,
        mentionQuery: detectTrigger(),
      });
    }, [serialize, detectTrigger, onChange]);

    const insertMention = useCallback(
      (member: MentionMember) => {
        const el = editorRef.current;
        const sel =
          typeof window !== "undefined" ? window.getSelection() : null;
        if (!el || !sel || sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);
        const container = range.endContainer;
        if (container.nodeType !== Node.TEXT_NODE) return;
        if (!el.contains(container)) return;
        const text = container.textContent ?? "";
        let atIdx = -1;
        for (let i = range.endOffset - 1; i >= 0; i--) {
          if (text[i] === "@") {
            atIdx = i;
            break;
          }
          if (/\s/.test(text[i])) return;
        }
        if (atIdx === -1) return;

        const replaceRange = document.createRange();
        replaceRange.setStart(container, atIdx);
        replaceRange.setEnd(container, range.endOffset);
        replaceRange.deleteContents();

        const chip = document.createElement("span");
        chip.setAttribute("contenteditable", "false");
        chip.dataset.mentionId = member.userId;
        chip.className = MENTION_CHIP_CLASS;
        chip.textContent = `@${member.username || member.name}`;

        const space = document.createTextNode(" ");
        replaceRange.insertNode(space);
        replaceRange.insertNode(chip);

        const newRange = document.createRange();
        newRange.setStartAfter(space);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
        el.focus();
        fireChange();
      },
      [fireChange]
    );

    useImperativeHandle(
      ref,
      () => ({
        clear: () => {
          const el = editorRef.current;
          if (!el) return;
          el.innerHTML = "";
          setIsEmpty(true);
          onChange({
            body: "",
            mentionedUserIds: [],
            isEmpty: true,
            mentionQuery: null,
          });
        },
        insertMention,
        focus: () => editorRef.current?.focus(),
      }),
      [insertMention, onChange]
    );

    const handlePaste = useCallback((e: React.ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      if (!text) return;
      document.execCommand("insertText", false, text);
    }, []);

    // Force a <br> on Enter rather than the browser default (which can wrap
    // the new line in a <div>), keeping serialize()'s DOM walk predictable.
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        document.execCommand("insertLineBreak");
      }
    }, []);

    return (
      <div className="relative flex-1">
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={fireChange}
          onKeyUp={fireChange}
          onKeyDown={handleKeyDown}
          onMouseUp={fireChange}
          onPaste={handlePaste}
          role="textbox"
          aria-multiline="true"
          aria-label="Comment"
          className="flex min-h-9 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30 whitespace-pre-wrap break-words"
        />
        {isEmpty && (
          <span className="pointer-events-none absolute left-2.5 top-2 text-base text-muted-foreground md:text-sm">
            {placeholder}
          </span>
        )}
      </div>
    );
  }
);

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
  const editorRef = useRef<MentionEditorHandle>(null);
  const [editorState, setEditorState] = useState<MentionEditorState>({
    body: "",
    mentionedUserIds: [],
    isEmpty: true,
    mentionQuery: null,
  });
  const debouncedQuery = useDebouncedValue(editorState.mentionQuery ?? "", 150);
  const createComment = useCreateComment();

  const { data: searchData } = useMentionSearch(
    editorState.mentionQuery !== null ? communityId : null,
    debouncedQuery,
    { enabled: editorState.mentionQuery !== null }
  );

  const canSubmit = !editorState.isEmpty && !createComment.isPending;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    createComment.mutate(
      {
        scoreId,
        workoutId,
        body: editorState.body.trimEnd(),
        mentionedUserIds: editorState.mentionedUserIds,
      },
      {
        onSuccess: () => {
          editorRef.current?.clear();
          onPosted();
        },
      }
    );
  }, [
    canSubmit,
    createComment,
    scoreId,
    workoutId,
    editorState.body,
    editorState.mentionedUserIds,
    onPosted,
  ]);

  return (
    <div className="border-t border-border/40 bg-background p-3">
      {editorState.mentionQuery !== null &&
        searchData?.members &&
        searchData.members.length > 0 && (
          <div className="mb-2 max-h-40 overflow-y-auto rounded-md border border-border/60 bg-popover shadow-sm">
            {searchData.members.map((m) => (
              <button
                key={m.userId}
                type="button"
                // Prevent the editor losing focus / its selection when the
                // user taps a popover row — without this, mobile Safari
                // collapses the range before insertMention can fire.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editorRef.current?.insertMention(m)}
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
        <MentionEditor
          ref={editorRef}
          onChange={setEditorState}
          placeholder="Add a comment… type @ to mention"
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
