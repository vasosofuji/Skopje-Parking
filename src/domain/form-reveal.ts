/** Reveal the expanded section with the least movement; long sections start at their header. */
export function formRevealOffset(top: number, height: number, offset: number, viewport: number, contentHeight: number, opening = true) {
  if (![top, height, offset, viewport, contentHeight].every(Number.isFinite) || viewport <= 0) return offset;
  const padding = 12;
  if (!opening && height > viewport - padding * 2) return offset;
  const bottom = top + height;
  let next = offset;
  if (height > viewport - padding * 2 || top < offset + padding) next = top - padding;
  else if (bottom > offset + viewport - padding) next = bottom - viewport + padding;
  return Math.max(0, Math.min(Math.max(0, contentHeight - viewport), next));
}
