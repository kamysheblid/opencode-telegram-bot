import { Context } from "grammy";
import { isTtsConfigured } from "../../app/services/tts-service.js";
import { setTtsMode, type TtsMode } from "../../app/stores/settings-store.js";
import { TTS_CALLBACK_PREFIX } from "../commands/tts-command.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

const TTS_MODES: TtsMode[] = ["off", "all", "auto"];

export async function handleTtsCallback(ctx: Context): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;

  if (!callbackQuery?.data || !callbackQuery.data.startsWith(TTS_CALLBACK_PREFIX)) {
    return false;
  }

  const mode = callbackQuery.data.slice(TTS_CALLBACK_PREFIX.length) as TtsMode;

  if (!TTS_MODES.includes(mode)) {
    return false;
  }

  if (mode !== "off" && !isTtsConfigured()) {
    await ctx.answerCallbackQuery({ text: t("tts.not_configured"), show_alert: true });
    return true;
  }

  setTtsMode(mode);

  const messageKey = mode === "off" ? "tts.off" : mode === "all" ? "tts.all" : "tts.auto";
  await ctx.answerCallbackQuery({ text: t(messageKey) });

  try {
    await ctx.deleteMessage();
  } catch (deleteError) {
    logger.warn("[TTS] Failed to delete mode selection message:", deleteError);

    try {
      await ctx.editMessageReplyMarkup();
    } catch (editError) {
      logger.warn("[TTS] Failed to remove mode selection keyboard:", editError);
    }
  }

  return true;
}
