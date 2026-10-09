import { requireOptionalNativeModule } from "expo";
import { Keyboard, Platform } from "react-native";

type MapKeyboardModule = { dismissForMap(): Promise<boolean> };
const native = Platform.OS === "android"
  ? requireOptionalNativeModule<MapKeyboardModule>("ParkinoMapKeyboard")
  : null;

/** Only call for direct interactions with our bundled, non-editable map. */
export async function dismissMapKeyboard(): Promise<boolean> {
  if (native) {
    // The native focus/window guard also decides whether this interaction is
    // still current. Do not blur a newly focused RN field before that check.
    try { return await native.dismissForMap(); } catch { return false; }
  }
  // Expo Go/older development clients lack this local module. Other platforms
  // retain RN's normal dismissal; production Android requires a native rebuild.
  Keyboard.dismiss();
  return true;
}
