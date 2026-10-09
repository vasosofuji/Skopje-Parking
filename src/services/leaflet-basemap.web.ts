import L from "leaflet";
import "maplibre-gl/dist/maplibre-gl.css";
import { maplibreGL } from "@maplibre/maplibre-gl-leaflet";
import { BASEMAP_ATTRIBUTION, createBasemapStyle } from "../domain/basemap-style";
import { guardVectorLayerRemoval, installBasemap } from "../domain/basemap-lifecycle";

export function addBasemap(map: L.Map, initialRaster?: L.TileLayer) {
  const override = process.env.EXPO_PUBLIC_TILE_URL;
  let initial = initialRaster;
  return installBasemap({
    addRaster: () => { if (initial) { const raster = initial; initial = undefined; return raster; } return L.tileLayer(override ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, keepBuffer: 4, updateWhenIdle: true, updateWhenZooming: false, attribution: BASEMAP_ATTRIBUTION }).addTo(map); },
    supported: () => typeof WebGL2RenderingContext !== "undefined",
    addVector: () => {
      const layer = maplibreGL({ style: createBasemapStyle(), attributionControl: false, interactive: false, maxZoom: 20, fadeDuration: 180 });
      guardVectorLayerRemoval(layer);
      try { layer.addTo(map); } catch (error) {
        try { layer.remove(); } catch { layer.getContainer()?.remove(); }
        console.warn("Vector basemap could not initialize; keeping raster map.", error);
        throw error;
      }
      const container = layer.getContainer(), gl = layer.getMaplibreMap();
      container.style.opacity = "0";
      container.style.pointerEvents = "none";
      return {
        remove: () => layer.remove(),
        show: () => { container.style.opacity = "1"; },
        onReady: (callback: () => void) => { gl.once("load", callback); },
        onError: (callback: (fatal?: boolean) => void) => { gl.on("error", () => callback()); gl.getCanvas().addEventListener("webglcontextlost", () => callback(true)); },
      };
    },
  }, Boolean(override));
}
