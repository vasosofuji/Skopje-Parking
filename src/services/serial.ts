/** A queue that starts each job after the previous one settles, so changes made together cannot drop each other. */
export function serialQueue() {
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>) => { const next = queue.then(work, work); queue = next.catch(() => {}); return next; };
}
