import { widgetPayPath } from "../domain/parking-widget";

/** Rewrites the home-screen widget's pay link onto the map; every other link is unchanged. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try { return widgetPayPath(path) ?? path; } catch { return "/"; }
}
