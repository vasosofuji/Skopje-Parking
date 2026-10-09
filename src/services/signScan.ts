import { Platform } from "react-native";
import type { SignInfo } from "../domain/types";
import type { ChosenPhoto } from "./photos";
import { readSignOnDevice, signReaderState, type SignReaderError } from "./signReader";
import { readSignOnPhone, SIGN_OCR_MODEL } from "./signOcr";

/** A sign read on this phone, waiting for the driver to check it. Only `info` is ever uploaded. */
export type SignDraft = { placeId: string; imageUri: string; info: SignInfo | null; model: string; problem: SignReaderError["kind"] | "unread" | null };

/** The driver's own AI key reads hard signs best; otherwise, or if it fails, ML Kit on the phone. */
export async function scanSign(placeId: string, photo: ChosenPhoto, knownZones: string[]): Promise<SignDraft> {
  let problem: SignDraft["problem"] = null;
  const key = await signReaderState.current();
  if (key) try {
    const reading = await readSignOnDevice(photo, key);
    return { placeId, imageUri: photo.uri, info: reading.info, model: reading.model, problem: null };
  } catch (error) { problem = (error as SignReaderError).kind ?? "unavailable"; }
  try {
    const info = await readSignOnPhone(photo.uri, knownZones);
    if (info) return { placeId, imageUri: photo.uri, info, model: SIGN_OCR_MODEL, problem: null };
  } catch { /* falls through to manual entry */ }
  return { placeId, imageUri: photo.uri, info: null, model: "manual", problem: problem ?? "unread" };
}

/** Sign photos are only processed, never kept: the app's working copy is deleted afterwards. */
export async function discardSignPhoto(uri: string | null | undefined) {
  if (!uri || Platform.OS === "web" || !uri.startsWith("file://")) return;
  try { const { File } = await import("expo-file-system"); const file = new File(uri); if (file.exists) file.delete(); } catch { /* already gone */ }
}
