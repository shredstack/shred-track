// Mention token helpers.
//
// Storage format for mentions in a comment body is `[mention:<userId>]`.
// The renderer substitutes display names at read time; renaming a user
// doesn't leave stale mentions in old comments.
//
// Both the comments POST/PATCH endpoints and the comment renderer call
// `parseMentionsFromBody` — so the format is load-bearing and any change
// to the regex below requires a migration script for existing comments.

const MENTION_RE = /\[mention:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;

export function parseMentionsFromBody(body: string): string[] {
  const ids = new Set<string>();
  for (const match of body.matchAll(MENTION_RE)) {
    ids.add(match[1].toLowerCase());
  }
  return [...ids];
}

/** True iff the multiset of mention tokens in `body` equals
 *  `mentionedUserIds` as a set. (We don't care about order or repeats
 *  within the body — `@sarah ... @sarah` still notifies sarah once.) */
export function mentionsMatch(
  body: string,
  mentionedUserIds: string[]
): boolean {
  const fromBody = new Set(parseMentionsFromBody(body));
  const fromArray = new Set(mentionedUserIds.map((id) => id.toLowerCase()));
  if (fromBody.size !== fromArray.size) return false;
  for (const id of fromBody) if (!fromArray.has(id)) return false;
  return true;
}

/** Split a body into ordered segments — either plain text or a mention token.
 *  Renderers use this to interleave text spans with mention chips. */
export type BodySegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; userId: string };

export function tokenizeBody(body: string): BodySegment[] {
  const out: BodySegment[] = [];
  let cursor = 0;
  for (const match of body.matchAll(MENTION_RE)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      out.push({ kind: "text", text: body.slice(cursor, start) });
    }
    out.push({ kind: "mention", userId: match[1].toLowerCase() });
    cursor = start + match[0].length;
  }
  if (cursor < body.length) {
    out.push({ kind: "text", text: body.slice(cursor) });
  }
  return out;
}
