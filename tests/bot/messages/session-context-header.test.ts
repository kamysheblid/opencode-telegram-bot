import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/app/services/session-service.js", () => ({
  getCurrentSession: vi.fn(),
}));
vi.mock("../../../src/app/stores/settings-store.js", () => ({
  getCurrentProject: vi.fn(),
}));

import { getCurrentSession } from "../../../src/app/services/session-service.js";
import { getCurrentProject } from "../../../src/app/stores/settings-store.js";
import {
  addContextHeader,
  formatContextHeader,
  parseContextHeader,
} from "../../../src/bot/messages/session-context-header.js";

describe("bot/messages/session-context-header", () => {
  const session = { id: "ses_abc123", title: "Implement login", directory: "/home/user/proj" };
  const project = { id: "proj_xyz", worktree: "/home/user/proj", name: "My Project" };

  describe("formatContextHeader", () => {
    it("includes raw worktree and session id separated from display labels", () => {
      const header = formatContextHeader(session, project);
      expect(header).toBe("📁 Project: /home/user/proj | My Project\n💬 Session: ses_abc123 | Implement login\n");
    });

    it("falls back to project worktree when name is missing", () => {
      const header = formatContextHeader(session, { ...project, name: undefined });
      expect(header).toBe("📁 Project: /home/user/proj | /home/user/proj\n💬 Session: ses_abc123 | Implement login\n");
    });

    it("falls back to session id when title is empty", () => {
      const header = formatContextHeader({ ...session, title: "" }, project);
      expect(header).toBe("📁 Project: /home/user/proj | My Project\n💬 Session: ses_abc123 | ses_abc123\n");
    });

    it("always ends with a trailing newline", () => {
      const header = formatContextHeader(session, project);
      expect(header.endsWith("\n")).toBe(true);
    });
  });

  describe("parseContextHeader", () => {
    it("returns null for plain text without header", () => {
      const result = parseContextHeader("Hello, please fix this bug");
      expect(result).toBeNull();
    });

    it("returns null for empty string", () => {
      const result = parseContextHeader("");
      expect(result).toBeNull();
    });

    it("returns null for single line", () => {
      const result = parseContextHeader("📁 Project: foo");
      expect(result).toBeNull();
    });

    it("returns null when first line has wrong prefix", () => {
      const result = parseContextHeader("📁 Projecto: foo\n💬 Session: bar");
      expect(result).toBeNull();
    });

    it("returns null when second line has wrong prefix", () => {
      const result = parseContextHeader("📁 Project: foo\n💬 Sessions: bar");
      expect(result).toBeNull();
    });

    it("returns null when project value is empty", () => {
      const result = parseContextHeader("📁 Project: \n💬 Session: bar");
      expect(result).toBeNull();
    });

    it("returns null when session value is empty", () => {
      const result = parseContextHeader("📁 Project: foo\n💬 Session: ");
      expect(result).toBeNull();
    });

    it("returns null when header is reversed", () => {
      const result = parseContextHeader("💬 Session: bar\n📁 Project: foo");
      expect(result).toBeNull();
    });

    it("accepts format without pipe separator (backwards compatibility)", () => {
      const result = parseContextHeader("📁 Project: /home/user/proj\n💬 Session: ses_abc123\nDo the thing.");
      expect(result).not.toBeNull();
      expect(result!.sessionId).toBe("ses_abc123");
      expect(result!.sessionTitle).toBe("ses_abc123");
      expect(result!.projectWorktree).toBe("/home/user/proj");
      expect(result!.projectName).toBe("/home/user/proj");
      expect(result!.remainingText).toBe("Do the thing.");
    });

    it("parses valid header and returns remainingText without the header", () => {
      const header = formatContextHeader(session, project);
      const prompt = "Please add error handling to the login form.";
      const result = parseContextHeader(header + prompt);

      expect(result).not.toBeNull();
      expect(result!.remainingText).toBe(prompt);
    });

    it("strips blank lines between header and prompt", () => {
      const header = formatContextHeader(session, project);
      const prompt = "Add tests for the auth module.";
      const result = parseContextHeader(header + "\n\n\n" + prompt);

      expect(result).not.toBeNull();
      expect(result!.remainingText).toBe(prompt);
    });

    it("returns correct raw IDs from round-trip with project name", () => {
      const header = formatContextHeader(session, project);
      const prompt = "Fix the bug in the login flow.";
      const result = parseContextHeader(header + prompt);

      expect(result).not.toBeNull();
      expect(result!.sessionId).toBe("ses_abc123");
      expect(result!.sessionTitle).toBe("Implement login");
      expect(result!.directory).toBe("/home/user/proj");
      expect(result!.projectWorktree).toBe("/home/user/proj");
      expect(result!.projectName).toBe("My Project");
      expect(result!.remainingText).toBe(prompt);
    });

    it("returns correct raw IDs when project name uses worktree fallback", () => {
      const projectNoName = { id: "proj_xyz", worktree: "/home/user/proj", name: undefined };
      const header = formatContextHeader(session, projectNoName);
      const prompt = "Refactor the database layer.";
      const result = parseContextHeader(header + prompt);

      expect(result).not.toBeNull();
      expect(result!.sessionId).toBe("ses_abc123");
      expect(result!.projectWorktree).toBe("/home/user/proj");
      expect(result!.projectName).toBe("/home/user/proj");
      expect(result!.remainingText).toBe(prompt);
    });

    it("returns correct raw session id when session title uses id fallback", () => {
      const sessionNoTitle = { id: "ses_abc123", title: "", directory: "/home/user/proj" };
      const header = formatContextHeader(sessionNoTitle, project);
      const result = parseContextHeader(header + "Do something.");

      expect(result).not.toBeNull();
      expect(result!.sessionId).toBe("ses_abc123");
      expect(result!.sessionTitle).toBe("ses_abc123");
    });

    it("strips whitespace-only lines between header and prompt", () => {
      const header = formatContextHeader(session, project);
      const prompt = "Actual prompt text.";
      const result = parseContextHeader(header + "  \n  \n" + prompt);

      expect(result).not.toBeNull();
      expect(result!.remainingText).toBe(prompt);
    });

    it("parses header from tool notification text", () => {
      const header = formatContextHeader(session, project);
      const toolText = "💻 bash: ls -la";
      const result = parseContextHeader(header + toolText);

      expect(result).not.toBeNull();
      expect(result!.sessionId).toBe("ses_abc123");
      expect(result!.remainingText).toBe(toolText);
    });

    it("parses header from subagent card text", () => {
      const header = formatContextHeader(session, project);
      const subagentText = "🏗 Subagent: building component";
      const result = parseContextHeader(header + subagentText);

      expect(result).not.toBeNull();
      expect(result!.sessionId).toBe("ses_abc123");
      expect(result!.remainingText).toBe(subagentText);
    });

    it("parses header from file caption text", () => {
      const header = formatContextHeader(session, project);
      const captionText = "📄 file.ts 10KB";
      const result = parseContextHeader(header + captionText);

      expect(result).not.toBeNull();
      expect(result!.sessionId).toBe("ses_abc123");
      expect(result!.remainingText).toBe(captionText);
    });

    it("returns null for command text like /status", () => {
      const result = parseContextHeader("/status");
      expect(result).toBeNull();
    });

    it("returns null for command text like /help", () => {
      const result = parseContextHeader("/help");
      expect(result).toBeNull();
    });

    it("returns null for error message text", () => {
      const result = parseContextHeader("Error: Something went wrong while processing your request.");
      expect(result).toBeNull();
    });
  });

  describe("addContextHeader", () => {
    const session = { id: "ses_abc123", title: "Implement login", directory: "/home/user/proj" };
    const project = { id: "proj_xyz", worktree: "/home/user/proj", name: "My Project" };

    it("plain text receives header", () => {
      vi.mocked(getCurrentSession).mockReturnValue(session);
      vi.mocked(getCurrentProject).mockReturnValue(project);

      const result = addContextHeader("Hello");

      expect(result).toMatch(/^📁 Project:/);
      expect(result).toMatch(/Hello$/);
    });

    it("already-headered text is not double-headered", () => {
      vi.mocked(getCurrentSession).mockReturnValue(session);
      vi.mocked(getCurrentProject).mockReturnValue(project);

      const headeredText = formatContextHeader(session, project) + "Existing";
      const result = addContextHeader(headeredText);

      const projectLineMatches = result.match(/^📁 Project:/gm);
      expect(projectLineMatches).toHaveLength(1);
    });

    it("missing session returns text unchanged", () => {
      vi.mocked(getCurrentSession).mockReturnValue(null);
      vi.mocked(getCurrentProject).mockReturnValue(project);

      const result = addContextHeader("Hello");

      expect(result).toBe("Hello");
    });

    it("missing project returns text unchanged", () => {
      vi.mocked(getCurrentSession).mockReturnValue(session);
      vi.mocked(getCurrentProject).mockReturnValue(undefined);

      const result = addContextHeader("Hello");

      expect(result).toBe("Hello");
    });

    it("empty string without session stays empty", () => {
      vi.mocked(getCurrentSession).mockReturnValue(null);
      vi.mocked(getCurrentProject).mockReturnValue(project);

      const result = addContextHeader("");

      expect(result).toBe("");
    });

    it("empty string with session gets header", () => {
      vi.mocked(getCurrentSession).mockReturnValue(session);
      vi.mocked(getCurrentProject).mockReturnValue(project);

      const result = addContextHeader("");

      expect(result).toMatch(/^📁 Project:/);
    });

    it("file caption text starts with context header", () => {
      vi.mocked(getCurrentSession).mockReturnValue(session);
      vi.mocked(getCurrentProject).mockReturnValue(project);

      const caption = "Review the changes in login.ts";
      const result = addContextHeader(caption);

      expect(result).toMatch(/^📁 Project:/);
      expect(result).toContain(caption);
    });

    it("repeated file caption does not duplicate header", () => {
      vi.mocked(getCurrentSession).mockReturnValue(session);
      vi.mocked(getCurrentProject).mockReturnValue(project);

      const headered = addContextHeader("Review the changes");
      const result = addContextHeader(headered);

      const projectLineMatches = result.match(/^📁 Project:/gm);
      expect(projectLineMatches).toHaveLength(1);
    });
  });
});
