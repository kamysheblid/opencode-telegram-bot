import fs from "node:fs/promises";
import { readFile } from "node:fs/promises";

import { cleanupBotRuntime, createBot } from "../../bot/index.js";
import { createScheduledTaskDeliverySender } from "../../bot/messages/scheduled-task-delivery.js";
import { config } from "../../config.js";
import { opencodeAutoRestartService } from "../../opencode/auto-restart.js";
import {
  notifyOpencodeReadyIfHealthy,
  registerOpenCodeReadyRefreshHandler,
} from "../../opencode/ready-refresh.js";
import { loadSettings } from "../stores/settings-store.js";
import { scheduledTaskRuntime } from "../services/scheduled-task-runtime-service.js";
import { reconcileStoredModelSelection } from "../services/model-selection-service.js";
import { getRuntimeMode } from "../../runtime/mode.js";
import { getRuntimePaths } from "../../runtime/paths.js";
import { clearServiceStateFile } from "../../runtime/service/manager.js";
import {
  getServiceStateFilePathFromEnv,
  isServiceChildProcess,
} from "../../runtime/service/env.js";
import { getLogFilePath, initializeLogger, logger } from "../../utils/logger.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import {
  formatTelegramError,
  isTelegramRetryableError,
  withTelegramRateLimitRetry,
} from "../../utils/telegram-rate-limit-retry.js";

const SHUTDOWN_TIMEOUT_MS = 5000;
const TELEGRAM_STARTUP_MAX_RETRIES = 5;
const TELEGRAM_STARTUP_BASE_DELAY_MS = 1000;
const TELEGRAM_STARTUP_MAX_DELAY_MS = 30_000;

async function getBotVersion(): Promise<string> {
  try {
    const packageJsonPath = new URL("../../../package.json", import.meta.url);
    const packageJsonContent = await readFile(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(packageJsonContent) as { version?: string };

    return packageJson.version ?? "unknown";
  } catch (error) {
    logger.warn("[App] Failed to read bot version", error);
    return "unknown";
  }
}

function getExponentialDelayMs(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  const cappedDelay = Math.min(
    TELEGRAM_STARTUP_BASE_DELAY_MS * 2 ** exponent,
    TELEGRAM_STARTUP_MAX_DELAY_MS,
  );
  const jitter = Math.floor(cappedDelay * 0.2 * Math.random());

  return Math.max(1, cappedDelay + jitter);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function getWebhookInfoWithRetry(bot: ReturnType<typeof createBot>) {
  return withTelegramRateLimitRetry(() => bot.api.getWebhookInfo(), {
    maxRetries: TELEGRAM_STARTUP_MAX_RETRIES,
    fallbackDelayMs: TELEGRAM_STARTUP_BASE_DELAY_MS,
    maxDelayMs: TELEGRAM_STARTUP_MAX_DELAY_MS,
    onRetry: ({ attempt, retryAfterMs, error }) => {
      logger.warn(
        `[Bot] Telegram startup request getWebhookInfo failed, retrying in ${retryAfterMs}ms (attempt=${attempt}): ${formatTelegramError(error)}`,
        error,
      );
    },
  });
}

async function startBotWithReconnect(bot: ReturnType<typeof createBot>): Promise<void> {
  let attempt = 0;

  while (true) {
    try {
      await bot.start({
        onStart: (botInfo) => {
          logger.info(`Bot @${botInfo.username} started!`);
        },
      });
      return;
    } catch (error) {
      if (!isTelegramRetryableError(error) || attempt >= TELEGRAM_STARTUP_MAX_RETRIES) {
        throw error;
      }

      attempt += 1;
      const delayMs = getExponentialDelayMs(attempt);
      cleanupBotRuntime(`telegram_reconnect_${attempt}`);

      logger.warn(
        `[Bot] Telegram long polling failed, reconnecting in ${delayMs}ms (attempt=${attempt}): ${formatTelegramError(error)}`,
        error,
      );
      await wait(delayMs);
    }
  }
}

export async function startBotApp(): Promise<void> {
  await initializeLogger();

  const mode = getRuntimeMode();
  const runtimePaths = getRuntimePaths();
  const version = await getBotVersion();
  const logFilePath = getLogFilePath();

  logger.info(`Starting OpenCode Telegram Bot v${version}...`);
  logger.info(`Config loaded from ${runtimePaths.envFilePath}`);
  if (logFilePath) {
    logger.info(`Logs are written to ${logFilePath}`);
  }
  logger.info(`Allowed User ID: ${config.telegram.allowedUserId}`);
  logger.debug(`[Runtime] Application start mode: ${mode}`);

  await loadSettings();
  await reconcileStoredModelSelection();
  registerOpenCodeReadyRefreshHandler();
  const bot = createBot();
  await scheduledTaskRuntime.initialize(
    bot,
    createScheduledTaskDeliverySender(bot.api, config.telegram.allowedUserId),
  );
  safeBackgroundTask({
    taskName: "app.opencodeStartup",
    task: async () => {
      await opencodeAutoRestartService.start();
      await notifyOpencodeReadyIfHealthy("startup");
    },
  });

  let shutdownStarted = false;
  let serviceStateCleared = false;
  let shutdownTimeout: ReturnType<typeof setTimeout> | null = null;

  const clearManagedServiceState = async (): Promise<void> => {
    if (!isServiceChildProcess() || serviceStateCleared) {
      return;
    }

    const stateFilePath = getServiceStateFilePathFromEnv();
    if (!stateFilePath) {
      return;
    }

    try {
      await fs.access(stateFilePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        serviceStateCleared = true;
        return;
      }

      throw error;
    }

    await clearServiceStateFile(stateFilePath);
    serviceStateCleared = true;
  };

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shutdownStarted) {
      return;
    }

    shutdownStarted = true;
    logger.info(`[App] Received ${signal}, shutting down...`);
    cleanupBotRuntime(`app_shutdown_${signal.toLowerCase()}`);
    opencodeAutoRestartService.stop();
    scheduledTaskRuntime.shutdown();

    shutdownTimeout = setTimeout(() => {
      logger.warn(`[App] Shutdown did not finish in ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit.`);
      process.exit(0);
    }, SHUTDOWN_TIMEOUT_MS);
    shutdownTimeout.unref?.();

    try {
      bot.stop();
    } catch (error) {
      logger.warn("[App] Failed to stop Telegram bot cleanly", error);
    }

    void clearManagedServiceState().catch((error) => {
      logger.warn("[App] Failed to clear managed service state", error);
    });
  };

  const handleSigint = (): void => shutdown("SIGINT");
  const handleSigterm = (): void => shutdown("SIGTERM");
  process.on("SIGINT", handleSigint);
  process.on("SIGTERM", handleSigterm);

  const webhookInfo = await getWebhookInfoWithRetry(bot);
  if (webhookInfo.url) {
    logger.info(`[Bot] Webhook detected: ${webhookInfo.url}, removing...`);
    await bot.api.deleteWebhook();
    logger.info("[Bot] Webhook removed, switching to long polling");
  }

  try {
    await startBotWithReconnect(bot);
  } finally {
    process.off("SIGINT", handleSigint);
    process.off("SIGTERM", handleSigterm);
    if (shutdownTimeout) {
      clearTimeout(shutdownTimeout);
      shutdownTimeout = null;
    }
    cleanupBotRuntime("app_shutdown_complete");
    opencodeAutoRestartService.stop();
    scheduledTaskRuntime.shutdown();
    await clearManagedServiceState().catch((error) => {
      logger.warn("[App] Failed to clear managed service state", error);
    });
  }
}
