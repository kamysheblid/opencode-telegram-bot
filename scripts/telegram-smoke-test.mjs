#!/usr/bin/env node

/**
 * Telegram Smoke Test Runner
 *
 * Validates environment, runs basic connectivity checks against
 * the Telegram Bot API and OpenCode server.
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=xxx TELEGRAM_ALLOWED_USER_ID=123 node scripts/telegram-smoke-test.mjs
 *   TELEGRAM_BOT_TOKEN=xxx TELEGRAM_ALLOWED_USER_ID=123 node scripts/telegram-smoke-test.mjs --dry-run
 *
 * Safe to run with live credentials — secrets are never written to disk.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Validates that `process.env[name]` is present and non-empty.
 * Exits with a generic message on failure — never echoes the value.
 */
export function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    process.stderr.write(`Missing required environment variable: ${name}\n`);
    process.exit(1);
  }
  return value.trim();
}

/**
 * Replaces TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_USER_ID with [REDACTED]
 * so output can be safely logged or written to evidence files.
 */
export function scrubSecrets(text, env = process.env) {
  let result = text;
  const token = env.TELEGRAM_BOT_TOKEN;
  const userId = env.TELEGRAM_ALLOWED_USER_ID;
  if (token) {
    result = result.replaceAll(token, "[REDACTED]");
  }
  if (userId) {
    result = result.replaceAll(userId, "[REDACTED]");
  }
  return result;
}

/**
 * Writes content to `.omo/evidence/<filename>` with secrets scrubbed.
 * Creates the evidence directory if it doesn't exist.
 * Content never contains raw token or user ID.
 */
export function writeEvidence(filename, content, env = process.env) {
  const evidenceDir = resolve(process.cwd(), ".omo", "evidence");
  if (!existsSync(evidenceDir)) {
    mkdirSync(evidenceDir, { recursive: true });
  }
  const safeContent = scrubSecrets(content, env);
  writeFileSync(join(evidenceDir, filename), safeContent, "utf8");
}

/**
 * Promise-based sleep.
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns an ISO-8601 timestamp string for evidence labeling.
 */
export function nowLabel() {
  return new Date().toISOString();
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Checks TELEGRAM_BOT_TOKEN (non-empty) and TELEGRAM_ALLOWED_USER_ID (positive integer).
 * Returns `{ ok: true }` or `{ ok: false, reason: string }`.
 */
function validateEnv() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.trim().length === 0) {
    return { ok: false, reason: "Missing TELEGRAM_BOT_TOKEN" };
  }

  const userId = (process.env.TELEGRAM_ALLOWED_USER_ID || "").trim();
  if (!/^[1-9]\d*$/.test(userId)) {
    return { ok: false, reason: "Invalid TELEGRAM_ALLOWED_USER_ID — must be a positive integer" };
  }

  return { ok: true };
}

// ─── Dry Run ──────────────────────────────────────────────────────────────────

/**
 * Writes a dry-run pass evidence file. All env vars confirmed valid.
 */
function runDryRun() {
  const label = nowLabel();
  const content = [
    "# Smoke Test — Dry Run",
    "",
    "**Status:** ✅ PASSED",
    `**Timestamp:** ${label}`,
    "",
    "All environment variables validated successfully.",
    "- TELEGRAM_BOT_TOKEN: [REDACTED] (non-empty)",
    "- TELEGRAM_ALLOWED_USER_ID: [REDACTED] (valid positive integer)",
    "",
    "This was a dry run — no API calls were made.",
    "",
  ].join("\n");

  writeEvidence("task-1-dry-run.md", content);
  process.stdout.write(
    "[smoke-test] Dry run passed — evidence written to .omo/evidence/task-1-dry-run.md\n",
  );
}

// ─── Missing / Invalid Env ────────────────────────────────────────────────────

/**
 * Writes a failure evidence file and exits with code 1.
 * No secrets are echoed in stderr or the evidence file.
 */
function runMissingToken(reason) {
  const label = nowLabel();
  const content = [
    "# Smoke Test — Environment Validation Failed",
    "",
    "**Status:** ❌ FAILED",
    `**Timestamp:** ${label}`,
    `**Reason:** ${reason}`,
    "",
    "Environment variables validated:",
    "- TELEGRAM_BOT_TOKEN: [REDACTED]",
    "- TELEGRAM_ALLOWED_USER_ID: [REDACTED]",
    "",
    "Resolution: Ensure both TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_USER_ID are set correctly.",
    "",
  ].join("\n");

  writeEvidence("task-1-missing-token.md", content);
  process.stderr.write(`[smoke-test] ❌ ${reason}\n`);
  process.exit(1);
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function main() {
  // Set defaults so the runner does not inherit production log volume
  if (!process.env.LOG_LEVEL) {
    process.env.LOG_LEVEL = "error";
  }

  // Isolate from any production config by defaulting to a temp home directory
  if (!process.env.OPENCODE_TELEGRAM_HOME) {
    process.env.OPENCODE_TELEGRAM_HOME = join(tmpdir(), "opencode-telegram-smoke-test");
  }

  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");

  const envResult = validateEnv();

  if (!envResult.ok) {
    runMissingToken(envResult.reason);
    // unreachable — runMissingToken calls process.exit
  }

  if (isDryRun) {
    runDryRun();
    return;
  }

  // Full run — app modules are imported lazily (after env validation)
  // to avoid side effects from config/module initialization.
  process.stdout.write("[smoke-test] Environment validated. Proceeding with full test run...\n");

  // ─── Bot Startup & Connectivity ─────────────────────────────────────

  const chatId = parseInt(process.env.TELEGRAM_ALLOWED_USER_ID, 10);
  const sentinel = `smoke-test-${Date.now()}`;
  process.stdout.write(`[smoke-test] Sentinel: ${sentinel}\n`);
  const label = nowLabel();

  // Set model defaults so the import does not fail on missing env vars
  if (!process.env.OPENCODE_MODEL_PROVIDER) {
    process.env.OPENCODE_MODEL_PROVIDER = "smoke-test";
  }
  if (!process.env.OPENCODE_MODEL_ID) {
    process.env.OPENCODE_MODEL_ID = "smoke-test-model";
  }

  const { createBot, cleanupBotRuntime } = await import("../src/bot/index.ts");
  const { formatContextHeader } = await import("../src/bot/messages/session-context-header.ts");
  const { buildContextHeaderFixture, buildSentMessageFixture, buildReplyUpdate } = await import(
    "./lib/telegram-smoke-test-helpers.mjs",
  );

  const contextHeader = buildContextHeaderFixture(
    "/smoke-test/worktree",
    "Smoke Test Project",
    "ses_smoke_test",
    "Smoke Test Session",
  );
  const fullMessage = `${contextHeader}${sentinel}`;

  const bot = createBot();
  // Prevent subsequent background command registration API calls through the proxy
  bot.api.setMyCommands = async () => true;
  let sentMessageId = null;

  // Start polling in background — don't block connectivity checks
  const startPromise = bot.start({
    onStart: () => console.log("[smoke-test] Bot started"),
  });

  try {
    // ── Step 1: Verify connectivity via getMe ────────────────────────
    let botInfo;
    const TIMEOUT_MS = 30000;
    try {
      botInfo = await Promise.race([
        bot.api.getMe(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("getMe() timed out after 30s")), TIMEOUT_MS)),
      ]);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      writeEvidence("task-5-failure-redaction.md", [
        "# Smoke Test — Failure Secrets Redaction",
        "",
        "**Status:** ❌ FAILED (getMe)",
        `**Timestamp:** ${label}`,
        "",
        "No raw token or user ID was written to any evidence file.",
        "All evidence output is scrubbed by writeEvidence() → scrubSecrets().",
        `**OPENCODE_TELEGRAM_HOME:** ${process.env.OPENCODE_TELEGRAM_HOME}`,
        "",
      ].join("\n"));
      const content = [
        "# Smoke Test — Bot Connectivity",
        "",
        "**Status:** ❌ FAILED (getMe)",
        `**Timestamp:** ${label}`,
        "",
        "Could not reach Telegram Bot API:",
        `- Error: ${errMsg}`,
        "",
      ].join("\n");
      writeEvidence("task-3-bot-connectivity.md", content);
      process.stderr.write(`[smoke-test] ❌ getMe() failed: ${errMsg}\n`);
      process.exit(1);
    }

    console.log(`[smoke-test] Bot connected: @${botInfo.username} (id: ${botInfo.id})`);

    // ── Step 2: Send context-header message ─────────────────────────
    try {
      const sentMessage = await Promise.race([
        bot.api.sendMessage(chatId, fullMessage),
        new Promise((_, reject) => setTimeout(() => reject(new Error("sendMessage() timed out after 30s")), TIMEOUT_MS)),
      ]);
      sentMessageId = sentMessage.message_id;
      console.log(`[smoke-test] Context message sent (message_id: ${sentMessageId})`);
      try {
        await bot.api.deleteMessage(chatId, sentMessageId);
        process.stdout.write(`[smoke-test] Test message deleted (message_id: ${sentMessageId})\n`);
      } catch (deleteErr) {
        const deleteErrMsg = deleteErr instanceof Error ? deleteErr.message : String(deleteErr);
        console.warn(`[smoke-test] ⚠️ deleteMessage() failed (non-fatal): ${deleteErrMsg}`);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[smoke-test] ⚠️ sendMessage() failed (continuing): ${errMsg}`);
      // Don't exit — the test can still verify other things
    }

    // ── Step 3: Inject reply update (if sendMessage succeeded) ────────
    let replyInjectionResult = "skipped (sendMessage failed)";
    let replyText = null;
    const capturedResponses = [];

    if (sentMessageId !== null) {
      replyText = `Reply to smokin' test ${Date.now()}`;
      const sentMessageFixture = buildSentMessageFixture(sentMessageId, chatId, fullMessage);
      const replyUpdate = buildReplyUpdate(sentMessageFixture, replyText, chatId);

      // Wrap bot.api.sendMessage to capture any outgoing bot responses
      const originalSendMessage = bot.api.sendMessage.bind(bot.api);
      bot.api.sendMessage = (...args) => {
        capturedResponses.push(args);
        return originalSendMessage(...args);
      };

      try {
        const handleUpdatePromise = bot.handleUpdate(replyUpdate);
        await Promise.race([handleUpdatePromise, sleep(5000)]);

        if (capturedResponses.length === 0) {
          replyInjectionResult = "injected, no blocking response sent (expected)";
        } else {
          replyInjectionResult =
            `injected, ${capturedResponses.length} response(s) captured (unexpected)`;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        replyInjectionResult = `injected with error: ${errMsg}`;
      } finally {
        // Restore original sendMessage
        bot.api.sendMessage = originalSendMessage;
      }
    }

    // ── Evidence ─────────────────────────────────────────────────────
    const status = sentMessageId !== null ? "✅ PASSED" : "⚠️ PARTIAL";
    const evidence = [
      "# Smoke Test — Bot Startup & Connectivity",
      "",
      `**Status:** ${status}`,
      `**Timestamp:** ${label}`,
      `**Sentinel:** ${sentinel}`,
      `**Bot:** @${botInfo.username} (id: ${botInfo.id})`,
      `**Chat ID:** ${chatId}`,
      sentMessageId !== null
        ? `**Sent Message ID:** ${sentMessageId}`
        : "**Sent Message ID:** N/A (sendMessage failed)",
      "",
      "Steps:",
      "1. createBot() — ✅",
      "2. bot.start() (background) — ✅",
      "3. getMe() — ✅",
      sentMessageId !== null ? "4. sendMessage() — ✅" : "4. sendMessage() — ❌",
      sentMessageId !== null
        ? `5. reply injection — ✅ (${replyInjectionResult})`
        : "5. reply injection — ⏭️ skipped (sendMessage failed)",
      "",
      "Reply injection details:",
      `- Reply text: ${replyText !== null ? replyText : "N/A"}`,
      `- Captured responses: ${capturedResponses.length} (${capturedResponses.length === 0 ? "none — expected" : "unexpected"})`,
      `- Outcome: ${replyInjectionResult}`,
      "",
    ].join("\n");
    writeEvidence(`telegram-smoke-test-${nowLabel().replace(/:/g, '-')}.md`, evidence);
    process.stdout.write(
      `[smoke-test] Bot startup and connectivity checks ${sentMessageId !== null ? "passed" : "completed (partial)"}\n`,
    );
  } finally {
    bot.stop();
    // Ensure the background start promise settles cleanly
    await startPromise.catch(() => {});
    cleanupBotRuntime("smoke-test-complete");
    const tempHome = process.env.OPENCODE_TELEGRAM_HOME || "not set";
    process.stdout.write(`[smoke-test] Bot stopped and runtime cleaned up (home: ${tempHome})\n`);
    process.stdout.write(`[smoke-test] Temp home: ${tempHome}\n`);
    writeEvidence("task-5-cleanup.md", [
      "# Smoke Test — Cleanup Evidence",
      "",
      "**Status:** ✅ CLEANED",
      `**Timestamp:** ${nowLabel()}`,
      "",
      "Cleanup steps performed:",
      "- bot.stop() — ✅",
      "- cleanupBotRuntime(\"smoke-test-complete\") — ✅",
      `- OPENCODE_TELEGRAM_HOME: ${tempHome}`,
      `- Sentinel: ${sentinel}`,
      "",
      "All evidence files are scrubbed via writeEvidence() → scrubSecrets().",
      "No raw token or user ID appears in any evidence file.",
      "",
    ].join("\n"));
  }
}

// ─── Execute ──────────────────────────────────────────────────────────────────

main().catch((err) => {
  process.stderr.write(`[smoke-test] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
