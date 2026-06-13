/**
 * Reply target resolver.
 *
 * Extracts a routing target from a Telegram reply-to-bot-message.
 * Called when a user replies to a bot-sent message that contains a
 * session context header (see session-context-header.ts).
 *
 * Returns a `ReplyTarget` when the replied message is from the bot and
 * contains a valid context header, or `null` when the message is not a
 * reply, has no header, or the replied message was sent by a non-bot user.
 */

import { type Context } from "grammy";
import { parseContextHeader } from "./session-context-header.js";

export interface ReplyTarget {
  /** Stable session ID from the context header (e.g. "ses_abc123"). */
  stableSessionId: string;
  /** Target OpenCode session ID (same as stableSessionId for now). */
  targetSessionId: string;
  /** Session directory (equals projectWorktree). */
  directory: string;
  /** Project worktree path. */
  projectWorktree: string;
  /** Human-readable project name, if available. */
  projectName?: string;
  /** Telegram chat ID where the reply was sent. */
  chatId: number;
}

/**
 * Resolves a reply-to-message into a routing target.
 *
 * Returns `null` when:
 * - The message is not a reply (`reply_to_message` is absent)
 * - The replied message has no `text` or `caption`
 * - The replied message was not sent by a bot (`from.is_bot !== true`)
 * - The replied message does not start with a valid context header
 */
export function resolveReplyTarget(ctx: Context): ReplyTarget | null {
  const replyTo = ctx.message?.reply_to_message;
  if (!replyTo) {
    return null;
  }

  // Extract text from either text or caption (photos with captions)
  const text = replyTo.text ?? replyTo.caption;
  if (!text || typeof text !== "string") {
    return null;
  }

  // Only route replies to messages sent by a bot
  if (!replyTo.from?.is_bot) {
    return null;
  }

  // Parse the session context header embedded in the message
  const parsed = parseContextHeader(text);
  if (!parsed) {
    return null;
  }

  const chatId = ctx.chat?.id;
  if (typeof chatId !== "number") {
    return null;
  }

  return {
    stableSessionId: parsed.sessionId,
    targetSessionId: parsed.sessionId,
    directory: parsed.directory,
    projectWorktree: parsed.projectWorktree,
    projectName: parsed.projectName,
    chatId,
  };
}
