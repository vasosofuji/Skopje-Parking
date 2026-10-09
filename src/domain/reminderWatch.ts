/** Serializes permission/storage checks against starts and opt-outs. */
export function createReminderWatch(enabled: () => Promise<boolean>, start: () => number, stop: (id: number) => void) {
  let id: number | null = null, generation = 0;
  return {
    running: () => id !== null,
    resume: async () => {
      const version = generation;
      if (id !== null || !await enabled()) return;
      // An opt-out or another resume can finish while storage was being read.
      if (version !== generation || id !== null) return;
      id = start();
    },
    stop: () => { generation++; if (id !== null) stop(id); id = null; },
  };
}
