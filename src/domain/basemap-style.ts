import liberty from "./openfreemap-liberty.json";
import offlineMap from "../../assets/offline-map/manifest.json";
import type { StyleSpecification, LayerSpecification } from "maplibre-gl";

export const BASEMAP_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://openfreemap.org/">OpenFreeMap</a> · <a href="https://openmaptiles.org/">OpenMapTiles</a>';

/** The Skopje extract bundled with the Android app (scripts/update-offline-map.mjs): no tile server. */
export const OFFLINE_BASEMAP: Pick<StyleSpecification, "sources" | "glyphs"> = {
  sources: { openmaptiles: { type: "vector", tiles: ["offline://tiles/{z}/{x}/{y}.pbf"], minzoom: offlineMap.minzoom, maxzoom: offlineMap.maxzoom,
    bounds: [offlineMap.bbox.west, offlineMap.bbox.south, offlineMap.bbox.east, offlineMap.bbox.north], attribution: BASEMAP_ATTRIBUTION } },
  glyphs: "offline://fonts/{fontstack}/{range}.pbf",
};

/** Keep street names and a quiet set of useful named businesses, without POI icons. */
export function createBasemapStyle(offline = false): StyleSpecification {
  const style = JSON.parse(JSON.stringify(liberty)) as StyleSpecification;
  style.name = "Parkino streets";
  style.layers = style.layers.filter(layer => {
    if (layer.type === "fill-extrusion" || layer.type === "raster") return false;
    if (layer.type !== "symbol") return true;
    return ["transportation_name", "place", "water_name", "waterway"].includes(layer["source-layer"] ?? "") && !layer.id.includes("shield");
  }).map(layer => {
    if (layer.type === "background") layer.paint = { "background-color": "#f3eee4" };
    if (layer.type === "fill") {
      const source = layer["source-layer"];
      const color = source === "water" ? "#c5d9d8" : source === "building" ? "#e3dace" : source === "park" || source === "landcover" ? "#e2e7d6" : "#eee8dc";
      layer.paint = { ...layer.paint, "fill-color": color };
      delete layer.paint["fill-pattern"];
      if (source === "building") layer.paint["fill-outline-color"] = "#d4c8b9";
    }
    if (layer.type === "line") {
      const source = layer["source-layer"];
      layer.paint = { ...layer.paint, "line-color": source === "waterway" ? "#bfd5d5" : source === "boundary" ? "#b6ada0" : layer.id.includes("casing") ? "#dbd0c0" : source === "transportation" ? "#fffdf8" : "#c7cdbb" };
    }
    if (layer.type === "symbol") {
      const layout = { ...layer.layout } as Record<string, unknown>;
      for (const key of Object.keys(layout)) if (key.startsWith("icon-")) delete layout[key];
      layer.layout = { ...layout, "text-allow-overlap": false, "text-ignore-placement": false } as typeof layer.layout;
      layer.paint = { ...layer.paint, "text-color": "#655b50", "text-halo-color": "#fffdf8", "text-halo-width": 1.5 };
    }
    return layer;
  });
  const businesses: LayerSpecification = {
    id: "parkino-named-businesses", type: "symbol", source: "openmaptiles", "source-layer": "poi", minzoom: 16,
    filter: ["all", ["has", "name"], ["!=", ["get", "name"], ""], ["match", ["get", "class"], ["shop", "food"], true, false]],
    layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-max-width": 10, "text-padding": 8, "text-allow-overlap": false, "text-ignore-placement": false, "symbol-sort-key": ["coalesce", ["get", "rank"], 100] },
    paint: { "text-color": "#796752", "text-halo-color": "#fffdf8", "text-halo-width": 1.6 },
  };
  // MapLibre places symbols in reverse layer order: streets must win collisions.
  const firstLabel = style.layers.findIndex(layer => layer.type === "symbol");
  style.layers.splice(firstLabel < 0 ? style.layers.length : firstLabel, 0, businesses);
  delete style.sprite;
  delete style.sources.ne2_shaded;
  style.transition = { duration: 180, delay: 0 };
  return offline ? { ...style, ...OFFLINE_BASEMAP } : style;
}

export function googleBasemapStyle(dark: boolean) {
  return [
    { elementType: "geometry", stylers: [{ color: dark ? "#42484b" : "#f3eee4" }] },
    { elementType: "labels.text.fill", stylers: [{ color: dark ? "#e0e1dc" : "#655b50" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: dark ? "#42484b" : "#fffdf8" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: dark ? "#3c595e" : "#c5d9d8" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: dark ? "#62696b" : "#fffdf8" }] },
    { featureType: "poi", stylers: [{ visibility: "off" }] },
    { featureType: "poi.business", elementType: "labels.text", stylers: [{ visibility: "on" }] },
    { featureType: "poi.place_of_worship", stylers: [{ visibility: "off" }] },
    { featureType: "transit", stylers: [{ visibility: "off" }] },
    { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  ];
}
