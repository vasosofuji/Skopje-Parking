/** Coalesce ordinary polls; a completed mutation can request one newer read. */
export function createRefreshCoordinator(load: (afterWrite: boolean) => Promise<void>, minimumInterval = 0, now = Date.now) {
  let running: Promise<void> | null = null;
  let followup = false;
  let lastFinished = -Infinity;
  return (afterWrite = false): Promise<void> => {
    if (running) {
      followup ||= afterWrite;
      return running;
    }
    if (!afterWrite && now() - lastFinished < minimumInterval) return Promise.resolve();
    running = Promise.resolve().then(async () => {
      // Followups only exist for writes, so they always need a read past shared caches.
      let fresh = afterWrite;
      try {
        do {
          followup = false;
          await load(fresh);
          lastFinished = now();
          fresh = true;
        } while (followup);
      } finally {
        // Release inside the pump, before its promise settles. A write arriving
        // between settlement microtasks must start a new read, not join an ended one.
        running = null;
      }
    });
    return running;
  };
}
