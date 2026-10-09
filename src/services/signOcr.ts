import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";
import { signFromText } from "../domain/sign-ocr";
import type { SignInfo } from "../domain/types";

/** Builds without the native recognizer (older installs, web) fall back to manual entry. */
export const signOcrAvailable = Platform.OS !== "web" && Boolean(requireOptionalNativeModule("ExpoTextExtractor"));
export const SIGN_OCR_MODEL = "ocr:mlkit-text-v2";

/** Reads a sign photo with Google ML Kit on the phone: no key, no network, nothing leaves the device. */
export async function readSignOnPhone(uri: string, knownZones: string[]): Promise<SignInfo | null> {
  if (!signOcrAvailable) return null;
  // Imported lazily so tests and older builds never load the native module.
  const { extractTextFromImage } = await import("expo-text-extractor");
  const info = signFromText(await extractTextFromImage(uri), knownZones);
  return info.isParkingSign ? info : null;
}
