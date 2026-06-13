/**
 * Session context header formatter and parser.
 *
 * Embeds stable project/session identifiers in Telegram messages so that
 * reply-to-session routing can reconstruct the context from a plain-text
 * message without relying on Telegram reply metadata.
 *
 * Header format (two lines, raw IDs separated by ` | ` from display labels):
 *
 *   📁 Project: <worktree> | <name or worktree>
 *   💬 Session: <id> | <title or id>
 *
 * Examples:
 *   📁 Project: /home/user/repo | My Repo
 *   💬 Session: ses_abc123 | Implement login
 *
 * Header labels are stable English strings — NOT localized.
 */

import { getCurrentSession } from "../../app/services/session-service.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";

export interface ParsedContext {
  /** Stable session ID (raw, e.g. "ses_abc123"). */
  sessionId: string;
  /** Human-readable session display label (e.g. "Implement login"). */
  sessionTitle: string;
  /** Session directory (equals projectWorktree). */
  directory: string;
  /** Project worktree path (stable directory, e.g. "/home/user/repo"). */
  projectWorktree: string;
  /** Human-readable project name (e.g. "My Repo"). */
  projectName: string | undefined;
  /** The original message text with the header lines stripped. */
  remainingText: string;
}

interface SessionLike {
  id: string;
  title: string;
  directory: string;
}

interface ProjectLike {
  id: string;
  worktree: string;
  name?: string;
}

const PROJECT_PREFIX = "📁 Project: ";
const SESSION_PREFIX = "💬 Session: ";
const VALUE_SEPARATOR = " | ";

/**
 * Formats a context header string from session and project info.
 *
 * The header includes the raw worktree path and session ID as the
 * machine-readable value, followed by a pipe separator and the human-readable
 * display label. The returned string always ends with a newline so the header
 * is visually separated from the message body that follows.
 */
export function formatContextHeader(session: SessionLike, project: ProjectLike): string {
  const projectDisplay = project.name || project.worktree;
  const sessionDisplay = session.title || session.id;

  return `${PROJECT_PREFIX}${project.worktree}${VALUE_SEPARATOR}${projectDisplay}\n${SESSION_PREFIX}${session.id}${VALUE_SEPARATOR}${sessionDisplay}\n`;
}

/**
 * Parses a context header from the start of a text message.
 *
 * Returns a `ParsedContext` if the header is present and valid, or `null`
 * if the text does not start with a valid header.
 *
 * When the header is found, the header lines (and any blank line immediately
 * after them) are stripped from the text and returned as `remainingText`.
 * When no header is found, `remainingText` is the original text unchanged.
 *
 * Each line is split on ` | ` to separate the raw/machine-readable value from
 * the human-readable display label. If no separator is present, the whole
 * value is used for both fields.
 */
export function parseContextHeader(text: string): ParsedContext | null {
  const lines = text.split("\n");

  if (lines.length < 2) {
    return null;
  }

  const firstLine = lines[0];
  const secondLine = lines[1];

  if (!firstLine.startsWith(PROJECT_PREFIX) || !secondLine.startsWith(SESSION_PREFIX)) {
    return null;
  }

  const projectRaw = firstLine.slice(PROJECT_PREFIX.length);
  const sessionRaw = secondLine.slice(SESSION_PREFIX.length);

  if (!projectRaw || !sessionRaw) {
    return null;
  }

  // Split on VALUE_SEPARATOR to separate raw ID from display label
  const projectSepIndex = projectRaw.indexOf(VALUE_SEPARATOR);
  const sessionSepIndex = sessionRaw.indexOf(VALUE_SEPARATOR);

  const projectWorktree = projectSepIndex >= 0 ? projectRaw.slice(0, projectSepIndex) : projectRaw;
  const projectDisplay = projectSepIndex >= 0 ? projectRaw.slice(projectSepIndex + VALUE_SEPARATOR.length) : projectRaw;

  const sessionId = sessionSepIndex >= 0 ? sessionRaw.slice(0, sessionSepIndex) : sessionRaw;
  const sessionDisplay = sessionSepIndex >= 0 ? sessionRaw.slice(sessionSepIndex + VALUE_SEPARATOR.length) : sessionRaw;

  if (!projectWorktree || !sessionId) {
    return null;
  }

  // Estimate lines to skip: header lines (2) plus any blank lines after them
  let skipCount = 2;
  while (skipCount < lines.length && lines[skipCount].trim() === "") {
    skipCount++;
  }

  const remainingText = lines.slice(skipCount).join("\n");

  return {
    sessionId,
    sessionTitle: sessionDisplay || sessionId,
    directory: projectWorktree,
    projectWorktree,
    projectName: projectDisplay || projectWorktree,
    remainingText,
  };
}

/**
 * Prepends a session/project context header to `text` if one is not already
 * present. Reads current session and project from global state.
 *
 * If the session or project is missing, or if `text` already begins with a
 * valid header, the text is returned unchanged.
 */
export function addContextHeader(text: string): string {
  const session = getCurrentSession();
  const project = getCurrentProject();

  if (!session || !project) {
    return text;
  }

  if (parseContextHeader(text) !== null) {
    return text;
  }

  return formatContextHeader(session, project) + text;
}
