const RETRY_STATUSES = new Set([429, 503]);
const MAX_ATTEMPTS = 3;
const MAX_WAIT_MS = 5000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Seconds in `Retry-After`, otherwise exponential backoff (500ms, 1s, ...); never more than 5s. */
function waitTime(res: Response, attempt: number) {
  const header = Number(res.headers.get('retry-after'));
  const ms = Number.isFinite(header) && header > 0 ? header * 1000 : 500 * 2 ** attempt;
  return Math.min(ms, MAX_WAIT_MS);
}

/**
 * `fetch` with a timeout that retries on HTTP 429 / 503 with backoff. Network errors and other
 * statuses are returned or thrown unchanged, so callers keep their own error handling.
 */
export async function fetchWithRetry(url: URL | string, init: RequestInit = {}, timeoutMs = 15000) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (!RETRY_STATUSES.has(res.status) || attempt >= MAX_ATTEMPTS - 1) return res;
    await sleep(waitTime(res, attempt));
  }
}
