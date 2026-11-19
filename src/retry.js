const RETRYABLE = new Set([429, 502, 503, 504]);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wraps a Jira request function with bounded retries. 429 and gateway errors are retried; a 500 is retried
 * except for writes. Retry-After wins over exponential backoff with full jitter. When a `deadline` is given
 * (the Forge runtime stops an invocation at 25 seconds) a retry that could not finish in time is not attempted,
 * and the failing response is returned so the caller can report it and resume in a later batch.
 * @param {import('./cloud-reader.js').RequestJira} request
 * @param {{ retries?: number, baseMs?: number, maxMs?: number, deadline?: number, now?: () => number,
 *   sleep?: (ms: number) => Promise<void>, random?: () => number }} [options]
 * @returns {import('./cloud-reader.js').RequestJira}
 */
export function withRetry(request, { retries = 4, baseMs = 500, maxMs = 20000, deadline = Infinity, now = Date.now, sleep = wait, random = Math.random } = {}) {
  const delayFor = (attempt, res) => {
    const advised = Number(res?.headers?.get?.('retry-after'));
    return Number.isFinite(advised) && advised >= 0 && res?.headers?.get?.('retry-after') !== null
      ? Math.min(advised * 1000, maxMs)
      : Math.min(maxMs, random() * baseMs * 2 ** attempt);
  };
  return async (path, init) => {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await request(path, init);
      } catch (error) {
        if (attempt >= retries || now() + delayFor(attempt) > deadline) throw error;
        await sleep(delayFor(attempt));
        continue;
      }
      const retryable = RETRYABLE.has(res.status) || (res.status === 500 && init?.method !== 'PUT');
      const pause = delayFor(attempt, res);
      if (!retryable || attempt >= retries || now() + pause > deadline) return res;
      await sleep(pause);
    }
  };
}
