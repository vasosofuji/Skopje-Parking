// Browsers have no keystore: a key entered on the web preview lasts only for this page load.
let value: string | null = null;
export const readerKeyStorage = {
  get: async () => value,
  set: async (next: string) => { value = next; },
  remove: async () => { value = null; },
};
