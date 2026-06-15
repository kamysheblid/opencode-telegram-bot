import { logger } from "../../utils/logger.js";

export type DeliveryMode = "stream" | "batch";

export interface ReplyTargetInfo {
  stableSessionId: string;
  targetSessionId: string;
  targetDirectory: string;
  projectWorktree: string;
  projectName: string | undefined;
  chatId: number;
  deliveryMode: DeliveryMode;
  startedAt: number;
}

class ReplyDeliveryRegistry {
  private readonly targets = new Map<string, ReplyTargetInfo>();

  register(target: ReplyTargetInfo): void {
    if (!target.stableSessionId || !target.targetSessionId || !target.targetDirectory) {
      return;
    }

    this.targets.set(target.stableSessionId, { ...target });
    logger.debug(
      `[ReplyDeliveryRegistry] Registered: stableSessionId=${target.stableSessionId}, targetSessionId=${target.targetSessionId}, directory=${target.targetDirectory}, chatId=${target.chatId}, mode=${target.deliveryMode}, count=${this.targets.size}`,
    );
  }

  unregister(stableSessionId: string): void {
    if (!this.targets.delete(stableSessionId)) {
      return;
    }

    logger.debug(
      `[ReplyDeliveryRegistry] Unregistered: stableSessionId=${stableSessionId}, count=${this.targets.size}`,
    );
  }

  lookup(stableSessionId: string): ReplyTargetInfo | null {
    const target = this.targets.get(stableSessionId);
    return target ? { ...target } : null;
  }

  cleanup(stableSessionId: string, reason: string): void {
    const target = this.targets.get(stableSessionId);
    if (!target) {
      return;
    }

    this.targets.delete(stableSessionId);
    logger.debug(
      `[ReplyDeliveryRegistry] Cleaned up: stableSessionId=${stableSessionId}, reason=${reason}, count=${this.targets.size}`,
    );
  }

  clearAll(reason: string): void {
    if (this.targets.size === 0) {
      return;
    }

    logger.info(
      `[ReplyDeliveryRegistry] Cleared all: reason=${reason}, count=${this.targets.size}`,
    );
    this.targets.clear();
  }

  getAll(): ReplyTargetInfo[] {
    return Array.from(this.targets.values(), (target) => ({ ...target }));
  }

  getCount(): number {
    return this.targets.size;
  }

  __resetForTests(): void {
    this.targets.clear();
  }
}

export const replyDeliveryRegistry = new ReplyDeliveryRegistry();
