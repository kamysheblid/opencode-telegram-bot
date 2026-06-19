import type { CommandContext, Context } from "grammy";
import { getProjects } from "../../app/services/project-service.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { syncSessionDirectoryCache } from "../../app/services/session-cache-service.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { formatTelegramError } from "../../utils/telegram-rate-limit-retry.js";
import {
  buildProjectsFallbackText,
  buildProjectsMenuView,
} from "../menus/project-selection-menu.js";
import { replyWithInlineMenuFallback } from "../menus/inline-menu.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";

export async function projectsCommand(ctx: CommandContext<Context>) {
  try {
    if (isForegroundBusy()) {
      await replyBusyBlocked(ctx);
      return;
    }

    await syncSessionDirectoryCache();
    const projects = await getProjects();

    if (projects.length === 0) {
      await ctx.reply(t("projects.empty"));
      return;
    }

    const { text, keyboard } = await buildProjectsMenuView(projects, 0);
    const fallbackText = buildProjectsFallbackText(projects, 0);

    await replyWithInlineMenuFallback(ctx, {
      menuKind: "project",
      text,
      keyboard,
      fallbackText,
    });
  } catch (error) {
    logger.error("[Bot] Error fetching projects:", error, formatTelegramError(error));
    await ctx.reply(t("projects.fetch_error"));
  }
}
