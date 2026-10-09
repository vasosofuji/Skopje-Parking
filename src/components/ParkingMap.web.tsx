import { translate, placeName } from "../domain/language";
import React, { useEffect, useRef, useState } from "react";
import { parkingSelectionZoom } from "../domain/map-selection-camera";
import L from "leaflet";
import "./leaflet.css";
import "./map.css";
import type { ParkingMapProps } from "./mapTypes";
import { createLayerCache } from "../domain/layer-cache";
import { SKOPJE } from "../domain/parking";
import { canInteractWithZone, isPocSector } from "../domain/zone-interaction";
import { groupParking } from "../domain/clusters";
import { parkingMarker, parkingMarkerHtml } from "../domain/marker-appearance";

function moveCamera(map: L.Map, point: L.LatLngTuple, zoom: number, animate = true) {
  map.stop();
  if (animate && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === false)
    map.flyTo(point, zoom, { animate: true, duration: 0.45, easeLinearity: 0.25 });
  else map.setView(point, zoom, { animate: false });
}

export default function ParkingMap(props: ParkingMapProps) {
  const host = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null),
    draftLayer = useRef<L.LayerGroup | null>(null);
  const layerCache = useRef<ReturnType<typeof createLayerCache<L.Layer>> | null>(null);
  const callbacks = useRef(props);
  const userDot = useRef<L.CircleMarker | null>(null), accuracyCircle = useRef<L.Circle | null>(null);
  const cameraMoving = useRef(false), destinationKey = useRef(""), selectionKey = useRef("");
  useEffect(() => {
    callbacks.current = props;
  }, [props]);
  const [zoom, setZoom] = useState(15);
  const [viewRevision, setViewRevision] = useState(0);
  useEffect(() => {
    if (!host.current) return;
    const instance = L.map(host.current, {
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: "center",
      minZoom: 3,
      zoomSnap: 0.5,
    }).setView([SKOPJE.latitude, SKOPJE.longitude], 15);
    // Keep broad tariff regions below actual parking footprints, including
    // when the layer cache recreates a changed region after the footprints.
    instance.createPane("tariff-regions").style.zIndex = "390";
    const raster = L.tileLayer(
      process.env.EXPO_PUBLIC_TILE_URL ??
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        keepBuffer: 4,
        updateWhenIdle: true,
        updateWhenZooming: false,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    ).addTo(instance);
    let basemapCleanup = () => { raster.remove(); };
    void import("../services/leaflet-basemap.web").then(({ addBasemap }) => {
      if (map.current === instance) basemapCleanup = addBasemap(instance, raster);
    }).catch(error => { console.warn("Vector basemap module unavailable; keeping raster map.", error); });
    layers.current = L.layerGroup().addTo(instance);
    layerCache.current = createLayerCache(layer => layer.addTo(layers.current!), layer => layers.current?.removeLayer(layer), layer => layer.off());
    draftLayer.current = L.layerGroup().addTo(instance);
    map.current = instance;
    instance.on("zoomend", () => setZoom(instance.getZoom()));
    instance.on("movestart", () => { cameraMoving.current = true; callbacks.current.onSelectedPosition?.(null); });
    instance.on("moveend", () => {
      cameraMoving.current = false;
      setViewRevision((value) => value + 1);
      const p = instance.getCenter();
      callbacks.current.onCenterChange?.({ latitude: p.lat, longitude: p.lng });
    });
    instance.on("dragstart", () => callbacks.current.onPan?.());
    instance.on("click", (event: L.LeafletMouseEvent) => {
      if (callbacks.current.picking)
        callbacks.current.onPick({
          latitude: event.latlng.lat,
          longitude: event.latlng.lng,
        });
      else callbacks.current.onBlankPress?.();
    });
    const resize = new ResizeObserver(() => instance.invalidateSize({ pan: false }));
    resize.observe(host.current);
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const motionChanged = (event: MediaQueryListEvent) => {
      if (!event.matches) return;
      instance.stop(); cameraMoving.current = false;
      const anchor = callbacks.current.selectedAnchor;
      callbacks.current.onSelectedPosition?.(callbacks.current.selectedId && anchor
        ? instance.latLngToContainerPoint([anchor.latitude, anchor.longitude]) : null);
    };
    motion?.addEventListener("change", motionChanged);
    return () => {
      motion?.removeEventListener("change", motionChanged);
      resize.disconnect();
      basemapCleanup();
      layerCache.current?.clear(); layerCache.current = null;
      instance.remove();
      map.current = null;
      layers.current = null;
      draftLayer.current = null;
      userDot.current = null;
      accuracyCircle.current = null;
    };
  }, []);
  useEffect(() => {
    const handler = map.current?.doubleClickZoom;
    if (props.drawing) { map.current?.stop(); cameraMoving.current = false; handler?.disable(); }
    else handler?.enable();
  }, [props.drawing]);
  useEffect(() => {
    const group = layers.current,
      instance = map.current;
    if (!group || !instance || !layerCache.current) return;
    const cache = layerCache.current;
    cache.begin();
    const retain = (key: string, state: unknown, create: () => L.Layer) => cache.use(key, JSON.stringify([state, props.picking, props.selectionEnabled, props.language]), create);
    const select = (
      place: ParkingMapProps["places"][number],
      point = place.coordinate,
    ) => {
      if (!canInteractWithZone(place, instance.getZoom(), callbacks.current.picking)) return;
      if (props.picking) callbacks.current.onPick(point);
      else if (props.selectionEnabled !== false)
        callbacks.current.onSelect(place, point);
    };
    if (!props.drawing && props.showZones) {
      for (const place of props.places.filter((p) => isPocSector(p))) {
        const selected = place.id === props.selectedId;
        const interactive = canInteractWithZone(place, zoom, props.picking);
        if (place.geometry) {
          retain(`zone:${place.id}`, [place, selected, interactive], () => L.polygon(
            place.geometry!.coordinates.map((ring) =>
              ring.map(([lon, lat]) => [lat, lon] as L.LatLngTuple),
            ),
            {
              pane: "tariff-regions",
              interactive,
              color: selected ? "#962e2b" : "#527FBA",
              weight: selected ? 2.5 : 1,
              dashArray: "5 5",
              fillOpacity: selected ? 0.14 : 0.035,
            },
          )
            .on("click", (event: L.LeafletMouseEvent) => {
              if (!canInteractWithZone(place, instance.getZoom(), callbacks.current.picking)) return;
              L.DomEvent.stopPropagation(event);
              select(place, {
                latitude: event.latlng.lat,
                longitude: event.latlng.lng,
              });
            })
            );
        }
        if (zoom >= 14 || selected) {
          const label = document.createElement("span");
          label.textContent = place.zoneCode ?? place.name;
          retain(`zone-label:${place.id}`, [place, selected, interactive], () => L.marker([place.coordinate.latitude, place.coordinate.longitude], {
            interactive, keyboard: interactive,
            autoPanOnFocus: false,
            icon: L.divIcon({
              className: "zone-label" + (!place.geometry ? " approximate" : ""),
              html: label,
              iconSize: [60, 44],
              iconAnchor: [30, 22],
            }),
            title: place.name,
            zIndexOffset: selected ? 1100 : -500,
          })
            .on("click", () => select(place))
            );
        }
      }
    }
    const longitudeStep = zoom < 18 ? (120 * 360) / (256 * 2 ** zoom) : 0;
    const latitudeStep =
      longitudeStep * Math.cos((SKOPJE.latitude * Math.PI) / 180);
    const bounds = instance.getBounds().pad(0.15);
    const visible = props.places.filter((place) =>
      bounds.contains([place.coordinate.latitude, place.coordinate.longitude]),
    );
    if (!props.drawing) {
      for (const place of visible.filter((p) => !isPocSector(p) && (props.showZones || p.kind !== "zone") && p.geometry && (zoom >= 17 || p.id === props.selectedId))) {
        const selected = place.id === props.selectedId;
        retain(`footprint:${place.id}`, [place, selected], () => L.polygon(place.geometry!.coordinates.map((ring) => ring.map(([lon, lat]) => [lat, lon] as L.LatLngTuple)), {
          color: "#962E2B", weight: selected ? 2.5 : 1.5, fillOpacity: selected ? 0.12 : 0.045,
        }).on("click", (event: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(event);
          select(place, { latitude: event.latlng.lat, longitude: event.latlng.lng });
        }));
      }
    }
    for (const members of groupParking(
      props.drawing ? [] : visible.filter(p => props.showZones || p.kind !== "zone"),
      latitudeStep,
      longitudeStep,
      props.selectedId,
      props.now,
      props.filtered,
    )) {
      const place = members[0],
        selected = place.id === props.selectedId,
        cluster = members.length > 1;
      const appearance = parkingMarker(place, members.length, props.now);
      const icon = L.divIcon({
        className:
          "parking-pin" +
          (selected ? " selected" : "") +
          (cluster ? " cluster" : "") +
          (appearance.spaces ? " spaces" : ""),
        html: parkingMarkerHtml(appearance),
        iconSize: [60, 48],
        iconAnchor: [30, 24],
      });
      const title = cluster
        ? members.length +
          (translate(props.language, " parking places", " паркинг локации"))
        : placeName(place, props.language);
      retain(`pin:${place.id}`, [place, selected, members.map(member => member.id), appearance], () => L.marker([place.coordinate.latitude, place.coordinate.longitude], {
        autoPanOnFocus: false,
        icon,
        title,
        zIndexOffset: selected
          ? 1000
          : appearance.spaces
            ? 800
            : 0,
      })
        .on("click", () => {
          if (props.picking) callbacks.current.onPick(place.coordinate);
          else if (props.selectionEnabled === false) return;
          else if (cluster) {
            callbacks.current.onPan?.();
            moveCamera(instance,
              [place.coordinate.latitude, place.coordinate.longitude],
              Math.min(19, instance.getZoom() + 1),
            );
          } else callbacks.current.onSelect(place);
        })
        );
    }
    const markerPoint =
      props.destinationMarker === undefined
        ? props.destination
        : props.destinationMarker;
    if (markerPoint && !props.drawing) {
      const title = document.createElement("span");
      title.textContent =
        props.destinationName ??
        (translate(props.language, "Destination", "Дестинација"));
      retain("destination", [markerPoint, title.textContent], () => L.marker([markerPoint.latitude, markerPoint.longitude], {
        icon: L.divIcon({
          className: "destination-pin",
          html: "<span></span>",
          iconSize: [34, 44],
          iconAnchor: [17, 44],
        }),
        title: title.textContent,
        zIndexOffset: 2000,
      })
        .bindTooltip(title, {
          permanent: true,
          direction: "top",
          offset: [0, -44],
          className: "destination-label",
        })
        );
    }
    cache.end();
    userDot.current?.bringToFront();
    const anchor = props.selectedAnchor;
    if (props.selectedId && anchor && !cameraMoving.current) {
      const p = instance.latLngToContainerPoint([
        anchor.latitude,
        anchor.longitude,
      ]);
      callbacks.current.onSelectedPosition?.({ x: p.x, y: p.y });
    } else callbacks.current.onSelectedPosition?.(null);

  }, [
    props.places,
    props.filtered,
    props.now,
    props.selectedId,
    props.selectedAnchor,
    props.destination,
    props.destinationMarker,
    props.destinationName,
    props.drawing,
    props.showZones,
    props.picking,
    props.selectionEnabled,
    props.language,
    zoom,
    viewRevision,
  ]);
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    if (!props.userLocation) {
      userDot.current?.remove(); userDot.current = null;
      accuracyCircle.current?.remove(); accuracyCircle.current = null;
      return;
    }
    const point: L.LatLngTuple = [props.userLocation.latitude, props.userLocation.longitude];
    if (userDot.current) userDot.current.setLatLng(point);
    else userDot.current = L.circleMarker(point, { radius: 7, fillColor: "#3977D5", color: "#fff", weight: 3, fillOpacity: 1, interactive: false }).addTo(instance);
    if (props.userAccuracy && props.userAccuracy > 0) {
      if (accuracyCircle.current) accuracyCircle.current.setLatLng(point).setRadius(props.userAccuracy);
      else accuracyCircle.current = L.circle(point, { radius: props.userAccuracy, color: "#3977D5", weight: 1, fillOpacity: 0.08, interactive: false }).addTo(instance);
    } else { accuracyCircle.current?.remove(); accuracyCircle.current = null; }
    userDot.current.bringToFront();
  }, [props.userLocation, props.userAccuracy]);
  // Keep handles alive while GPS/catalog updates redraw the other overlays.
  useEffect(() => {
    const group = draftLayer.current;
    if (!group) return;
    const draft = (props.draftCoordinates ?? []).map(
      (p) => [p.latitude, p.longitude] as L.LatLngTuple,
    );
    const outline = L.polyline(draft, {
      color: "#962e2b",
      weight: 3,
      dashArray: "7 5",
      interactive: false,
    }).addTo(group);
    const polygon =
      draft.length > 2
        ? L.polygon(draft, {
            color: "#962e2b",
            weight: 1,
            fillOpacity: 0.12,
            interactive: false,
          }).addTo(group)
        : null;
    draft.forEach((point, index) => {
      const marker = L.marker(point, {
        draggable: Boolean(props.drawing),
        autoPan: true,
        zIndexOffset: 3000,
        title:
          (translate(callbacks.current.language, "Corner ", "Агол ")) +
          (index + 1),
        icon: L.divIcon({
          className: "zone-vertex",
          html: "<span></span>",
          iconSize: [44, 44],
          iconAnchor: [22, 22],
        }),
      }).addTo(group);
      marker.on("click", L.DomEvent.stopPropagation);
      marker.on("drag", () => {
        const p = marker.getLatLng();
        draft[index] = [p.lat, p.lng];
        outline.setLatLngs(draft);
        polygon?.setLatLngs(draft);
      });
      marker.on("dragend", () => {
        const p = marker.getLatLng();
        callbacks.current.onMoveVertex?.(index, {
          latitude: p.lat,
          longitude: p.lng,
        });
      });
      marker.on("keydown", (event: L.LeafletKeyboardEvent) => {
        if (!callbacks.current.drawing) return;
        const offsets: Record<string, [number, number]> = {
          ArrowUp: [0, -3],
          ArrowDown: [0, 3],
          ArrowLeft: [-3, 0],
          ArrowRight: [3, 0],
        };
        const delta = offsets[event.originalEvent.key];
        if (!delta || !map.current) return;
        L.DomEvent.preventDefault(event.originalEvent);
        L.DomEvent.stopPropagation(event.originalEvent);
        const p = map.current.layerPointToLatLng(
          map.current.latLngToLayerPoint(marker.getLatLng()).add(delta),
        );
        callbacks.current.onMoveVertex?.(index, {
          latitude: p.lat,
          longitude: p.lng,
        });
      });
    });
    return () => {
      const old = group.getLayers();
      group.clearLayers();
      old.forEach((layer) => layer.off());
    };
  }, [props.draftCoordinates, props.drawing]);
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const key = `${props.destination.latitude},${props.destination.longitude}:${props.cameraRevision ?? 0}:${props.cameraZoom ?? 15}`;
    const selected = props.selectedId && props.selectedAnchor ? `${props.selectedId}:${props.selectedAnchor.latitude},${props.selectedAnchor.longitude}` : "";
    if (key !== destinationKey.current) {
      const initial = !destinationKey.current;
      destinationKey.current = key;
      moveCamera(instance, [props.destination.latitude, props.destination.longitude], props.cameraZoom ?? 15, !initial && !props.drawing);
    } else if (selected && selected !== selectionKey.current && !props.picking && !props.drawing) {
      const place = props.places.find(place => place.id === props.selectedId);
      moveCamera(instance, [props.selectedAnchor!.latitude, props.selectedAnchor!.longitude], parkingSelectionZoom(instance.getZoom(), Boolean(place && isPocSector(place))), false);
    }
    selectionKey.current = selected;
  }, [
    props.destination.latitude,
    props.destination.longitude,
    props.cameraRevision,
    props.cameraZoom,
    props.selectedId,
    props.selectedAnchor,
    props.places,
    props.picking,
    props.drawing,
  ]);
  return (
    <div
      ref={host}
      className={props.dark ? "parking-map-dark" : ""}
      aria-label={
        translate(props.language, "Skopje parking map", "Мапа на паркинзи во Скопје")
      }
      style={{
        width: "100%",
        height: "100%",
        cursor: props.picking ? "crosshair" : undefined,
      }}
    />
  );
}
