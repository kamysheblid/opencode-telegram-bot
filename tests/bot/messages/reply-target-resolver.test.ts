import { describe, expect, it } from "vitest";
import type { Context } from "grammy";
import {
  resolveReplyTarget,
  type ReplyTarget,
} from "../../../src/bot/messages/reply-target-resolver.js";
import { formatContextHeader } from "../../../src/bot/messages/session-context-header.js";

const SESSION = {
  id: "ses_abc123",
  title: "Implement login",
  directory: "/home/user/proj",
};

const PROJECT = {
  id: "proj_xyz",
  worktree: "/home/user/proj",
  name: "My Project",
};

const CHAT_ID = 42_300;

interface FakeCtx {
  message?: {
    text?: string;
    reply_to_message?: {
      text?: string;
      caption?: string;
      from?: { is_bot: boolean };
    };
  };
  chat?: { id: number };
}

function makeCtx(overrides: Partial<FakeCtx>): Context {
  return {
    message: { text: "user reply" },
    chat: { id: CHAT_ID },
    ...overrides,
  } as unknown as Context;
}

function validHeaderText(): string {
  return formatContextHeader(SESSION, PROJECT) + "Some prompt text from the session.";
}

describe("bot/messages/reply-target-resolver", () => {
  describe("resolveReplyTarget", () => {
    it("returns null when message is not a reply", () => {
      const ctx = makeCtx({ message: { text: "hello" } });
      // No reply_to_message set
      const result = resolveReplyTarget(ctx);
      expect(result).toBeNull();
    });

    it("returns null when replied message has no text or caption", () => {
      const ctx = makeCtx({
        message: {
          text: "user reply",
          reply_to_message: {
            from: { is_bot: true },
            // No text, no caption
          } as { from: { is_bot: boolean } },
        },
      });
      const result = resolveReplyTarget(ctx);
      expect(result).toBeNull();
    });

    it("returns null when replied message has empty text", () => {
      const ctx = makeCtx({
        message: {
          text: "user reply",
          reply_to_message: {
            text: "",
            from: { is_bot: true },
          },
        },
      });
      const result = resolveReplyTarget(ctx);
      expect(result).toBeNull();
    });

    it("returns null when replied message has no context header (plain text)", () => {
      const ctx = makeCtx({
        message: {
          text: "user reply",
          reply_to_message: {
            text: "Just a normal message without any header.",
            from: { is_bot: true },
          },
        },
      });
      const result = resolveReplyTarget(ctx);
      expect(result).toBeNull();
    });

    it("returns null when replied message is from a non-bot user", () => {
      const ctx = makeCtx({
        message: {
          text: "user reply",
          reply_to_message: {
            text: validHeaderText(),
            from: { is_bot: false },
          },
        },
      });
      const result = resolveReplyTarget(ctx);
      expect(result).toBeNull();
    });

    it("returns null when replied message has malformed header", () => {
      const ctx = makeCtx({
        message: {
          text: "user reply",
          reply_to_message: {
            text: "📁 Project: /home/user/proj\n💬 Session: \n",
            from: { is_bot: true },
          },
        },
      });
      const result = resolveReplyTarget(ctx);
      expect(result).toBeNull();
    });

    it("returns null when from field is missing on replied message", () => {
      const ctx = makeCtx({
        message: {
          text: "user reply",
          reply_to_message: {
            text: validHeaderText(),
            // No from field at all
          } as { text: string },
        },
      });
      const result = resolveReplyTarget(ctx);
      expect(result).toBeNull();
    });

    it("returns valid ReplyTarget when replied message has a valid header in text", () => {
      const ctx = makeCtx({
        message: {
          text: "user reply",
          reply_to_message: {
            text: validHeaderText(),
            from: { is_bot: true },
          },
        },
      });
      const result = resolveReplyTarget(ctx);
      expect(result).not.toBeNull();
      expect(result!.stableSessionId).toBe("ses_abc123");
      expect(result!.targetSessionId).toBe("ses_abc123");
      expect(result!.directory).toBe("/home/user/proj");
      expect(result!.projectWorktree).toBe("/home/user/proj");
      expect(result!.projectName).toBe("My Project");
      expect(result!.chatId).toBe(CHAT_ID);
    });

    it("returns valid ReplyTarget when replied message has a valid header in caption", () => {
      const ctx = makeCtx({
        message: {
          text: "user reply",
          reply_to_message: {
            caption: validHeaderText(),
            from: { is_bot: true },
          },
        },
      });
      const result = resolveReplyTarget(ctx);
      expect(result).not.toBeNull();
      expect(result!.stableSessionId).toBe("ses_abc123");
      expect(result!.directory).toBe("/home/user/proj");
    });

    it("populates all fields correctly from parsed context", () => {
      const customSession = {
        id: "ses_xyz789",
        title: "Refactor database",
        directory: "/var/www/app",
      };
      const customProject = {
        id: "proj_abc",
        worktree: "/var/www/app",
        name: "Web App",
      };
      const header = formatContextHeader(customSession, customProject) + "Do the needful.";
      const ctx = makeCtx({
        chat: { id: 99 },
        message: {
          text: "user reply",
          reply_to_message: {
            text: header,
            from: { is_bot: true },
          },
        },
      });
      const result = resolveReplyTarget(ctx);
      expect(result).not.toBeNull();
      expect(result!.stableSessionId).toBe("ses_xyz789");
      expect(result!.targetSessionId).toBe("ses_xyz789");
      expect(result!.directory).toBe("/var/www/app");
      expect(result!.projectWorktree).toBe("/var/www/app");
      expect(result!.projectName).toBe("Web App");
      expect(result!.chatId).toBe(99);
    });

    it("returns null when there is no replied message text, caption is also absent", () => {
      const ctx = makeCtx({
        message: {
          text: "user reply",
          reply_to_message: {
            from: { is_bot: true },
          } as { from: { is_bot: boolean } },
        },
      });
      const result = resolveReplyTarget(ctx);
      expect(result).toBeNull();
    });

    it("routes from headered tool notification text", () => {
      const headerText = validHeaderText() + "💻 bash: ls -la";
      const ctx = makeCtx({
        message: {
          text: "user reply",
          reply_to_message: {
            text: headerText,
            from: { is_bot: true },
          },
        },
      });
      const result = resolveReplyTarget(ctx);
      expect(result).not.toBeNull();
      expect(result!.stableSessionId).toBe("ses_abc123");
      expect(result!.targetSessionId).toBe("ses_abc123");
      expect(result!.directory).toBe("/home/user/proj");
    });

    it("routes from headered subagent card text", () => {
      const headerText = validHeaderText() + "🏗 Subagent: building component";
      const ctx = makeCtx({
        message: {
          text: "user reply",
          reply_to_message: {
            text: headerText,
            from: { is_bot: true },
          },
        },
      });
      const result = resolveReplyTarget(ctx);
      expect(result).not.toBeNull();
      expect(result!.stableSessionId).toBe("ses_abc123");
      expect(result!.targetSessionId).toBe("ses_abc123");
      expect(result!.directory).toBe("/home/user/proj");
    });

    it("returns null for plain command text without header", () => {
      const ctx = makeCtx({
        message: {
          text: "user reply",
          reply_to_message: {
            text: "/status",
            from: { is_bot: true },
          },
        },
      });
      const result = resolveReplyTarget(ctx);
      expect(result).toBeNull();
    });
  });
});
