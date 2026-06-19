import { CommandContext, Context, InlineKeyboard } from "grammy";
import { getTtsMode, type TtsMode } from "../../app/stores/settings-store.js";
import { t } from "../../i18n/index.js";

export const TTS_CALLBACK_PREFIX = "tts:";

export function buildTtsModeKeyboard(current: TtsMode): InlineKeyboard {
  return new InlineKeyboard()
    .text(`${current === "off" ? "✅ " : ""}🔇 ${t("status.tts.off")}`, `${TTS_CALLBACK_PREFIX}off`)
    .row()
    .text(`${current === "all" ? "✅ " : ""}🔊 ${t("status.tts.all")}`, `${TTS_CALLBACK_PREFIX}all`)
    .row()
    .text(
      `${current === "auto" ? "✅ " : ""}🎤 ${t("status.tts.auto")}`,
      `${TTS_CALLBACK_PREFIX}auto`,
    );
}

export async function ttsCommand(ctx: CommandContext<Context>): Promise<void> {
  const current = getTtsMode();
  const keyboard = buildTtsModeKeyboard(current);

  await ctx.reply(t("tts.prompt"), { reply_markup: keyboard });
}
