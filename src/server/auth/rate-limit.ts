import "server-only";

/**
 * In-memory login throttle. Per process, which is fine for a single internal
 * instance; move to the database or Redis alongside a real DB.
 */

const MAX_ATTEMPTS = 6;
const WINDOW_MS = 10 * 60 * 1000;

const attempts = new Map<string, { count: number; firstAt: number }>();

export function checkLoginAllowed(key: string): { allowed: boolean; retryInMinutes: number } {
  const record = attempts.get(key);
  if (!record) return { allowed: true, retryInMinutes: 0 };

  const elapsed = Date.now() - record.firstAt;
  if (elapsed > WINDOW_MS) {
    attempts.delete(key);
    return { allowed: true, retryInMinutes: 0 };
  }
  if (record.count < MAX_ATTEMPTS) return { allowed: true, retryInMinutes: 0 };

  return {
    allowed: false,
    retryInMinutes: Math.max(1, Math.ceil((WINDOW_MS - elapsed) / 60000)),
  };
}

export function recordFailedLogin(key: string) {
  const record = attempts.get(key);
  if (!record || Date.now() - record.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: Date.now() });
    return;
  }
  record.count += 1;
}

export function clearLoginAttempts(key: string) {
  attempts.delete(key);
}
