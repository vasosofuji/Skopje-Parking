import type { Coordinate } from "./types";

// Android identifies bubbled overlays; Apple MapKit follows polygon.onPress with
// an unlabelled map press at the same coordinate. Consume only that paired event.
export function createOverlayTapGate(clock = Date.now) {
  let last: { point: Coordinate; at: number } | null = null;
  return {
    record(point: Coordinate) { last = { point, at: clock() }; },
    consume(action: string | undefined, point: Coordinate) {
      const previous = last; last = null;
      if (action && ["marker-press", "polygon-press", "polyline-press", "overlay-press", "image-overlay-press"].includes(action)) return true;
      return Boolean(previous && clock() - previous.at < 400 &&
        Math.abs(previous.point.latitude - point.latitude) < 0.000001 && Math.abs(previous.point.longitude - point.longitude) < 0.000001);
    },
  };
}
