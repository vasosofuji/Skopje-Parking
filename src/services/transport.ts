// Probe readiness before sending writes. A sleeping host can take a minute to
// wake; retrying the probe is safe, replaying a report or registration is not.
export class ParkingRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export function createTransport(base: string, options: {
  fetcher?: typeof fetch;
  clock?: () => number;
  pause?: (ms: number) => Promise<void>;
} = {}) {
  const fetcher = options.fetcher ?? fetch;
  const clock = options.clock ?? Date.now;
  const pause = options.pause ?? ((ms) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  let readyUntil = 0;
  let limitedUntil = 0;
  let warming: Promise<void> | undefined;
  async function timed<T>(milliseconds: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('Connection interrupted. Refresh to check whether your change was saved before trying again.'));
        controller.abort();
      }, milliseconds);
    });
    try { return await Promise.race([operation(controller.signal), expired]); }
    finally { clearTimeout(timer); }
  }
  async function ready() {
    if (clock() < limitedUntil) throw new ParkingRequestError('Too many requests. Please wait a moment and try again.', 429);
    if (clock() < readyUntil) return;
    if (!warming) warming = (async () => {
      const deadline = clock() + 75000;
      let unanswered = 0;
      while (clock() < deadline) {
        try {
          const probe = await timed(Math.max(1, Math.min(15000, deadline - clock())), async signal => {
            const response = await fetcher(base + '/health', {
              signal,
              credentials: 'omit', redirect: 'error',
            });
            return { response, healthy: response.ok && (await response.json()).status === 'ok' };
          });
          const { response } = probe;
          if (probe.healthy) {
            readyUntil = clock() + 60000;
            return;
          }
          if (response.status === 429) {
            const seconds = Number(response.headers.get('Retry-After'));
            limitedUntil = clock() + (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : 30) * 1000;
            throw new ParkingRequestError('Too many requests. Please wait a moment and try again.', 429);
          }
        } catch (error) {
          if (error instanceof ParkingRequestError) throw error;
          // Retry only the read-only readiness probe. A waking server still answers; no answer
          // at all means no network, so stop early and let the app show it is offline.
          if (++unanswered >= 3) break;
        }
        if (clock() < deadline) await pause(Math.min(2000, deadline - clock()));
      }
      throw new Error('Could not connect to the parking server. Please try again.');
    })().finally(() => { warming = undefined; });
    await warming;
  }
  return async function request<T>(path: string, init?: RequestInit): Promise<T> {
    await ready();
    return timed(15000, async signal => {
      let response: Response;
      try {
        response = await fetcher(base + path, {
          ...init,
          signal,
          credentials: 'omit', redirect: 'error',
          headers: {
            ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...init?.headers,
          },
        });
      } catch {
        readyUntil = 0;
        throw new Error('Connection interrupted. Refresh to check whether your change was saved before trying again.');
      }
      if (!response.ok) {
        if (response.status >= 500) readyUntil = 0;
        const body = await response.json().catch(() => ({}));
        throw new ParkingRequestError(typeof body.error === 'string' ? body.error : response.status === 429
          ? 'Too many requests. Please wait a moment and try again.' : 'Could not connect. Please try again.', response.status);
      }
      return response.json() as Promise<T>;
    }).catch(error => {
      if (!(error instanceof ParkingRequestError)) readyUntil = 0;
      throw error;
    });
  };
}
