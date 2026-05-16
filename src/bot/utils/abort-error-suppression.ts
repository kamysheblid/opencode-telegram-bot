const USER_ABORT_SUPPRESSION_WINDOW_MS = 30_000;

const userAbortRequestedAtBySession = new Map<string, number>();

export function markUserAbortRequested(sessionId: string): void {
  userAbortRequestedAtBySession.set(sessionId, Date.now());
}

export function shouldSuppressUserAbortSessionError(sessionId: string, message: string): boolean {
  if (message.trim().toLowerCase() !== "aborted") {
    return false;
  }

  const requestedAt = userAbortRequestedAtBySession.get(sessionId);
  if (requestedAt === undefined) {
    return false;
  }

  userAbortRequestedAtBySession.delete(sessionId);
  return Date.now() - requestedAt <= USER_ABORT_SUPPRESSION_WINDOW_MS;
}

export function __resetUserAbortErrorSuppressionForTests(): void {
  userAbortRequestedAtBySession.clear();
}
