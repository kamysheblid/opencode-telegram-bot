import { CommandContext, Context } from "grammy";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { replyWithInlineMenuFallback } from "../menus/inline-menu.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../config.js";
import { t } from "../../i18n/index.js";
import { formatTelegramError } from "../../utils/telegram-rate-limit-retry.js";
import {
  buildSessionSelectionMenuView,
  buildSessionsFallbackText,
  loadSessionPage,
} from "../menus/session-selection-menu.js";

export async function sessionsCommand(ctx: CommandContext<Context>) {
  try {

    const pageSize = config.bot.sessionsListLimit;
    const currentProject = getCurrentProject();

    if (!currentProject) {
      await ctx.reply(t("sessions.project_not_selected"));
      return;
    }

    logger.debug(`[Sessions] Fetching sessions for directory: ${currentProject.worktree}`);

    const firstPage = await loadSessionPage(currentProject.worktree, 0, pageSize);

    logger.debug(`[Sessions] Found ${firstPage.sessions.length} sessions on page 1`);
    firstPage.sessions.forEach((session) => {
      logger.debug(`[Sessions] Session: ${session.title} | ${session.directory}`);
    });

    if (firstPage.sessions.length === 0) {
      await ctx.reply(t("sessions.empty"));
      return;
    }

    const { text, keyboard } = buildSessionSelectionMenuView(firstPage, pageSize);
    const fallbackText = buildSessionsFallbackText(firstPage, pageSize);

    await replyWithInlineMenuFallback(ctx, {
      menuKind: "session",
      text,
      keyboard,
      fallbackText,
    });
  } catch (error) {
    logger.error("[Sessions] Error fetching sessions:", error, formatTelegramError(error));
    await ctx.reply(t("sessions.fetch_error"));
  }
}
