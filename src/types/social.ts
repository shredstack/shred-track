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

export type NotificationKind =
  | "score_reaction"
  | "score_comment"
  | "score_mention";

export interface NotificationDisplay {
  id: string;
  kind: NotificationKind;
  actorName: string | null;
  actorImage: string | null;
  workoutTitle: string;
  /** Date (YYYY-MM-DD) so the deep link can navigate to the right day. */
  workoutDate: string | null;
  workoutId: string;
  workoutPartId: string | null;
  scoreId: string | null;
  commentId: string | null;
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
