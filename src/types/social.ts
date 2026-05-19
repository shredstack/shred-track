// Social — comments, mentions, reactions, notifications, GIF picker.
// See claude_code_instructions/social/crossfit_leaderboard_social_spec.md.

export interface CommentAttachment {
  provider: "klipy";
  kind: "gif" | "meme" | "sticker";
  id: string;
  url: string;
  previewUrl: string;
  width: number;
  height: number;
}

export interface CommentMention {
  userId: string;
  name: string;
  username: string | null;
}

export interface CommentDisplay {
  id: string;
  scoreId: string;
  userId: string;
  userName: string;
  userUsername: string | null;
  userImage: string | null;
  /** Plain text with `[mention:<userId>]` tokens. Client resolves at render. */
  body: string;
  mentions: CommentMention[];
  attachment: CommentAttachment | null;
  createdAt: string;
  updatedAt: string;
  isEdited: boolean;
  isOwn: boolean;
}

export interface ReactionSummary {
  count: number;
  viewerReacted: boolean;
}

// Re-exported from the schema so the inbox, push dispatcher, and DB CHECK
// constraint share one source of truth for the kind list.
export type { NotificationKind } from "@/db/schema";
import type { NotificationKind } from "@/db/schema";

export interface NotificationDisplay {
  id: string;
  kind: NotificationKind;
  actorName: string | null;
  actorImage: string | null;
  workoutTitle: string;
  /** Date (YYYY-MM-DD) so the deep link can navigate to the right day. */
  workoutDate: string | null;
  workoutId: string | null;
  workoutPartId: string | null;
  programmingReleaseId: string | null;
  /** Monday-anchored start date (YYYY-MM-DD) for workout_published kind. */
  releaseWeekStart: string | null;
  scoreId: string | null;
  commentId: string | null;
  gymPostId: string | null;
  classInstanceId: string | null;
  communityId: string | null;
  /** Gym/community display name (for "from your gym" framing). */
  gymName: string | null;
  /** Class title for class_* kinds. */
  className: string | null;
  /** Class start ISO for class_reservation_reminder. */
  classStartAt: string | null;
  /** Excerpt source for social_post_* kinds (post body) or score comments. */
  bodyPreview?: string;
  hasAttachment?: boolean;
  readAt: string | null;
  createdAt: string;
}

// GIF picker — returned by the Klipy proxy at /api/gifs/search and friends.
export interface GifPickerItem {
  id: string;
  kind: "gif" | "meme" | "sticker";
  url: string;
  previewUrl: string;
  width: number;
  height: number;
  title?: string;
}

export interface GifSearchResult {
  items: GifPickerItem[];
  nextCursor: string | null;
  available?: boolean;
}

// Mention chips in the comment input — the client builds this and serializes
// to `[mention:<userId>]` tokens on submit.
export interface MentionMember {
  userId: string;
  name: string;
  username: string | null;
}
