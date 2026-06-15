/**
 * Telegram smoke test helper utilities.
 *
 * Provides pure functions to build Telegram Update fixtures for smoke tests.
 * Self-contained — no imports from project source files or external APIs.
 */

/**
 * Builds a context header string matching `formatContextHeader()` from
 * `src/bot/messages/session-context-header.ts`.
 *
 * Format: "📁 Project: {worktree} | {displayName}\n💬 Session: {id} | {displayTitle}\n"
 *
 * When projectName is falsy, projectWorktree is used as the display name.
 * When sessionTitle is falsy, sessionId is used as the display title.
 *
 * @param {string} projectWorktree - Raw worktree path
 * @param {string | undefined} projectName - Human-readable project name
 * @param {string} sessionId - Raw session ID
 * @param {string | undefined} sessionTitle - Human-readable session title
 * @returns {string} Two-line context header ending with newline
 */
export function buildContextHeaderFixture(
  projectWorktree,
  projectName,
  sessionId,
  sessionTitle,
) {
  const projectDisplay = projectName || projectWorktree;
  const sessionDisplay = sessionTitle || sessionId;

  return `📁 Project: ${projectWorktree} | ${projectDisplay}\n💬 Session: ${sessionId} | ${sessionDisplay}\n`;
}

/**
 * Builds a partial Telegram Message object representing a bot-sent message.
 *
 * @param {number} messageId - Telegram message ID
 * @param {number} chatId - Chat/user ID
 * @param {string} text - Message text content
 * @returns {object} Partial Telegram Message
 */
export function buildSentMessageFixture(messageId, chatId, text) {
  return {
    message_id: messageId,
    date: Math.floor(Date.now() / 1000),
    text,
    chat: { id: chatId, type: "private" },
    from: { id: chatId, is_bot: false, first_name: "Test" },
  };
}

/**
 * Builds a Telegram Update object representing a user reply to a bot message.
 *
 * The reply message's `from.id` is set to `allowedUserId` and
 * `reply_to_message.from.is_bot` is forced to `true` to simulate
 * the bot's own message being replied to.
 *
 * @param {object} sentMessage - The bot message being replied to
 * @param {string} replyText - The user's reply text
 * @param {number} allowedUserId - The authorized Telegram user ID
 * @returns {object} Telegram Update with reply_to_message
 */
export function buildReplyUpdate(sentMessage, replyText, allowedUserId) {
  const uniqueId = Math.floor(Math.random() * 2147483647) + 1;

  return {
    update_id: Math.floor(Math.random() * 2147483647) + 1,
    message: {
      message_id: uniqueId,
      date: Math.floor(Date.now() / 1000),
      text: replyText,
      from: { id: allowedUserId, is_bot: false },
      chat: { id: allowedUserId, type: "private" },
      reply_to_message: {
        ...sentMessage,
        from: { ...sentMessage.from, is_bot: true },
      },
    },
  };
}

/**
 * Asserts that the Telegram update comes from the authorized user.
 *
 * @param {object} update - Telegram Update object
 * @param {number} allowedUserId - The authorized Telegram user ID
 * @throws {Error} If the update's sender ID does not match the allowed user ID
 */
export function assertAuthorizedUser(update, allowedUserId) {
  const senderId = update.message?.from?.id;

  if (senderId !== allowedUserId) {
    throw new Error(
      `Unauthorized user: got ${senderId}, expected ${allowedUserId}`,
    );
  }
}
