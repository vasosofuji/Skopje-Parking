export function parkingPreviewLayout(point: { x: number; y: number }, width: number, mapHeight: number, drawerHeight: number, cardHeight: number) {
  const cardWidth = Math.min(290, Math.max(0, width - 24));
  const left = Math.max(12, Math.min(width - cardWidth - 12, point.x - cardWidth / 2));
  const floor = Math.max(12, Math.min(128, mapHeight - drawerHeight - cardHeight - 12));
  const top = Math.max(floor, Math.min(mapHeight - drawerHeight - cardHeight - 12, point.y - cardHeight - 18));
  return { width: cardWidth, left, top, arrowLeft: Math.max(16, Math.min(cardWidth - 34, point.x - left - 10)),
    showArrow: Math.abs(top + cardHeight + 18 - point.y) <= 2,
    visible: point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= mapHeight && mapHeight - drawerHeight >= cardHeight + 24 };
}
