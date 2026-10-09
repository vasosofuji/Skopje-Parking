import * as SecureStore from "expo-secure-store";

const KEY = "parkino-sign-reader";
/** The driver's own AI key lives only in the device keystore and is never sent to Parkino's server. */
export const readerKeyStorage = {
  get: () => SecureStore.getItemAsync(KEY),
  set: (value: string) => SecureStore.setItemAsync(KEY, value),
  remove: () => SecureStore.deleteItemAsync(KEY),
};
