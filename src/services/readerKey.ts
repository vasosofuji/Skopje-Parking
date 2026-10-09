import * as SecureStore from "expo-secure-store";

const KEY = "skopje-parking-sign-reader";
// Keys saved before the app was renamed move to the new name on first read.
const LEGACY_KEY = "parkino-sign-reader";
/** The driver's own AI key lives only in the device keystore and is never sent to Skopje Parking's server. */
export const readerKeyStorage = {
  get: async () => {
    const value = await SecureStore.getItemAsync(KEY);
    if (value !== null) return value;
    const legacy = await SecureStore.getItemAsync(LEGACY_KEY);
    if (legacy !== null) {
      await SecureStore.setItemAsync(KEY, legacy);
      await SecureStore.deleteItemAsync(LEGACY_KEY);
    }
    return legacy;
  },
  set: (value: string) => SecureStore.setItemAsync(KEY, value),
  remove: async () => { await SecureStore.deleteItemAsync(KEY); await SecureStore.deleteItemAsync(LEGACY_KEY); },
};
