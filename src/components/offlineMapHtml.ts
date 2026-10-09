import { maplibreScript, maplibreStyles } from "../vendor/maplibre";
import { BASEMAP_ATTRIBUTION, createBasemapStyle, OFFLINE_BASEMAP } from "../domain/basemap-style";
import { guardVectorLayerRemoval, installBasemap, registerOfflineBasemap } from "../domain/basemap-lifecycle";
import { createLayerCache } from "../domain/layer-cache";
import { parkingSelectionZoom } from "../domain/map-selection-camera";
import { leafletScript, leafletStyles } from "../vendor/leaflet";
const tileUrl =
  process.env.EXPO_PUBLIC_TILE_URL ??
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const mapHtml = `<!doctype html><html><head>
<title>Skopje Parking map</title>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>${maplibreStyles}</style>
<style>${leafletStyles}html,body,#map{height:100%;width:100%;margin:0}.leaflet-container{touch-action:none}.leaflet-bottom{bottom:2px}.leaflet-control-attribution{font-size:10px!important;background:rgba(255,255,255,.85)!important}.dark .leaflet-tile-pane{filter:invert(.88) hue-rotate(180deg) brightness(1.15) contrast(.8) saturate(.35)}.dark.leaflet-container{background:#42484b}</style>
<style>
.parking-pin{display:flex;align-items:center;justify-content:center;background:transparent;border:0}
.parking-pin-face{position:relative;box-sizing:border-box;display:flex;align-items:center;justify-content:center;min-width:28px;height:28px;padding:0 5px;border:2px solid #fff;border-radius:16px;color:#fff;font:800 12px system-ui;box-shadow:0 2px 5px #173d3a35}
.parking-pin.selected .parking-pin-face{outline:3px solid #d9a48d;outline-offset:2px}
.parking-pin.spaces .parking-pin-face{width:36px;min-width:36px;height:36px;padding:0;flex-shrink:0;border-radius:50%;box-shadow:0 0 0 3px #26c77930}
.parking-free-badge,.parking-state-badge{position:absolute;right:-7px;top:-8px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:17px;height:17px;border:1px solid #087184;border-radius:9px;background:#fff;color:#07596A;font:800 10px system-ui}
.parking-state-badge{left:-7px;right:auto;top:auto;bottom:-8px;color:#fff;border-color:#fff}
.zone-label{display:flex;align-items:center;justify-content:center}
.parking-review-badge{position:absolute;right:-7px;top:-8px;width:17px;height:17px;box-sizing:border-box;text-align:center;border:1px solid #65529A;border-radius:9px;background:#fff;color:#65529A;font:800 10px/15px system-ui}
.zone-vertex{display:flex;align-items:center;justify-content:center}.zone-vertex span{width:18px;height:18px;border:3px solid #fff;border-radius:50%;background:#962e2b;box-shadow:0 1px 5px #392c2570}
.destination-pin span{display:block;width:28px;height:28px;border:3px solid #fff;border-radius:50% 50% 50% 0;background:#ce383e;transform:rotate(-45deg);box-shadow:-2px 2px 7px #50202050}.destination-pin span::after{content:'';display:block;width:9px;height:9px;border-radius:50%;background:#fff;margin:9px}
.destination-label{border:none;border-radius:8px;color:#8e1822;padding:6px 10px;max-width:210px;overflow:hidden;text-overflow:ellipsis;font:700 12px system-ui;box-shadow:0 2px 8px #50202025}
</style></head><body><div id="map" aria-label="Skopje parking map"></div>
<script>${leafletScript}
${maplibreScript}</script><script>
(function(){
const send = (message) => window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({...message,sentAt:Date.now()}));
const map = L.map('map',{zoomControl:false,attributionControl:false,minZoom:3,zoomSnap:.5}).setView([41.9961,21.4316],15);
map.createPane('tariff-regions').style.zIndex='390';
const parkingSelectionZoom = ${parkingSelectionZoom.toString()};
// The streets ship inside the app (Android assets); without them the map uses OpenFreeMap online.
const basemapStyle=${JSON.stringify(createBasemapStyle())};
let disposeBasemap=()=>{};
const startBasemap=offline=>{if(offline)Object.assign(basemapStyle,${JSON.stringify(OFFLINE_BASEMAP)});disposeBasemap=(${installBasemap.toString()})({
  addRaster:()=>L.tileLayer(${JSON.stringify(tileUrl)},{maxZoom:19,keepBuffer:4,updateWhenIdle:true,updateWhenZooming:false,attribution:${JSON.stringify(BASEMAP_ATTRIBUTION)}}).addTo(map),
  supported:()=>typeof maplibregl!=='undefined' && typeof WebGL2RenderingContext!=='undefined',
  addVector:()=>{
    const layer=L.maplibreGL({style:basemapStyle,attributionControl:false,interactive:false,maxZoom:20,fadeDuration:180});
    (${guardVectorLayerRemoval.toString()})(layer);
    try{layer.addTo(map);}catch(error){try{layer.remove();}catch{layer.getContainer()?.remove();}throw error;}
    const container=layer.getContainer(),gl=layer.getMaplibreMap();container.style.opacity='0';container.style.pointerEvents='none';
    return {remove:()=>layer.remove(),show:()=>{container.style.opacity='1';},onReady:callback=>gl.once('load',callback),onError:callback=>{gl.on('error',()=>callback());gl.getCanvas().addEventListener('webglcontextlost',()=>callback(true));}};
  }
},${Boolean(process.env.EXPO_PUBLIC_TILE_URL)},15000,${Boolean(process.env.EXPO_PUBLIC_TILE_URL)});};
if(typeof maplibregl!=='undefined')(${registerOfflineBasemap.toString()})(maplibregl,'file:///android_asset/offline-map/',XMLHttpRequest,startBasemap);
else startBasemap(false);
window.addEventListener('pagehide',()=>disposeBasemap());
const group = L.layerGroup().addTo(map);
const layerCache = (${createLayerCache.toString()})(layer=>layer.addTo(group),layer=>group.removeLayer(layer),layer=>layer.off());
let userDot = null, userAccuracy = null;
window.updateUserLocation = function(point,accuracy) {
  if(!point){if(userDot){userDot.remove();userDot=null;}if(userAccuracy){userAccuracy.remove();userAccuracy=null;}return;}
  if(userDot)userDot.setLatLng(point);
  else userDot=L.circleMarker(point,{radius:7,fillColor:'#3977D5',color:'#fff',weight:3,fillOpacity:1,interactive:false}).addTo(map);
  if(accuracy>0){
    if(userAccuracy)userAccuracy.setLatLng(point).setRadius(accuracy);
    else userAccuracy=L.circle(point,{radius:accuracy,color:'#3977D5',weight:1,fillOpacity:.08,interactive:false}).addTo(map);
  }else if(userAccuracy){userAccuracy.remove();userAccuracy=null;}
  userDot.bringToFront();
};
let current = null;
let destinationKey = '', selectionKey = '', cameraMoving = false, cameraChanging = false;
const motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
motion?.addEventListener('change',event=>{if(event.matches){map.stop();cameraMoving=false;position();}});
function moveCamera(point,zoom,animate=true){
  cameraChanging=true;
  map.stop();
  cameraMoving=false;
  if(animate && motion && !motion.matches)map.flyTo(point,zoom,{animate:true,duration:.45,easeLinearity:.25});
  else map.setView(point,zoom,{animate:false});
  cameraChanging=false;position();
}
let dragging = false, pending = null;
map.on('dragstart',()=>send({type:'pan'}));
map.on('movestart',()=>{cameraMoving=true;position();});
function position(){if(current && current.selectedId && current.selectedAnchor){const p=cameraMoving||cameraChanging?null:map.latLngToContainerPoint(current.selectedAnchor);send({type:'position',selectionId:current.selectedId,anchor:current.selectedAnchor,point:p?{x:p.x,y:p.y}:null});}else send({type:'position',selectionId:null,anchor:null,point:null});}
map.on('moveend',()=>{cameraMoving=false;const p=map.getCenter();send({type:'center',latitude:p.lat,longitude:p.lng});position();});
map.on('zoomend',()=>send({type:'zoom',zoom:map.getZoom()}));
map.on('click',event=>{if(current && current.picking)send({type:'pick',latitude:event.latlng.lat,longitude:event.latlng.lng});else send({type:'blank'});});
function zoneInteractive() { return true; }
function select(id,latlng) {
  const zone=current.zones?.find(zone=>zone.id===id)||current.zoneLabels?.find(zone=>zone.id===id);
  if(zone&&!zoneInteractive(zone))return;
  if(current.picking)send({type:'pick',latitude:latlng.lat,longitude:latlng.lng});
  else if(current.selectionEnabled!==false)send({type:'select',id,latitude:latlng.lat,longitude:latlng.lng});
}
window.renderParking = function(next) {
  if(dragging){pending=next;return;}
  const enteringDrawing = next.drawing && !current?.drawing;
  current = next;
  if(enteringDrawing){map.stop();cameraMoving=false;}
  // Two quick corner taps must not be interpreted as a zoom around that point.
  if(next.drawing)map.doubleClickZoom.disable();else map.doubleClickZoom.enable();
  document.getElementById("map").classList.toggle("dark",Boolean(next.dark));
  layerCache.begin();
  const retain=(key,state,create)=>layerCache.use(key,JSON.stringify(state),create);
  (next.footprints || []).forEach(area=>{
    if(!area.selected && !map.getBounds().intersects(L.latLngBounds(area.rings[0])))return;
    retain('footprint:'+area.id,area,()=>L.polygon(area.rings,{color:'#962E2B',weight:area.selected?2.5:1.5,fillOpacity:area.selected?.12:.045})
      .on('click',event=>{L.DomEvent.stopPropagation(event);select(area.id,event.latlng);}));
  });
  next.zones.forEach(zone=>{
    const interactive=zoneInteractive(zone);
    retain('zone:'+zone.id,[zone,interactive],()=> { const polygon = L.polygon(zone.rings,{pane:'tariff-regions',interactive,color:'#527FBA',weight:1,dashArray:'5 5',fillOpacity:0.035});
    polygon.on('click',event=>{if(!zoneInteractive(zone))return;L.DomEvent.stopPropagation(event);select(zone.id,event.latlng);});
    return polygon; });
  });
  (next.zoneLabels || []).forEach(zone=>{
    const label=document.createElement('span');label.textContent=zone.label;
    label.style.cssText='background:#fff;color:#392c25;border:1px '+(zone.approximate?'dashed':'solid')+' #527FBA;border-radius:6px;padding:3px 6px;font:600 12px system-ui;white-space:nowrap';
    const interactive=zoneInteractive(zone);
    retain('zone-label:'+zone.id,[zone,interactive],()=>L.marker(zone.point,{interactive,keyboard:interactive,autoPanOnFocus:false,zIndexOffset:-500,icon:L.divIcon({className:'zone-label',html:label,iconSize:[60,44],iconAnchor:[30,22]}),title:zone.title}).on('click',()=>select(zone.id,{lat:zone.point[0],lng:zone.point[1]})));
  });
  next.pins.forEach(pin=>{
    retain('pin:'+pin.id,pin,()=> { const icon=L.divIcon({className:'parking-pin'+(pin.selected?' selected':'')+(pin.cluster?' cluster':'')+(pin.spaces?' spaces':''),html:pin.html,iconSize:[60,48],iconAnchor:[30,24]});
    const marker=L.marker(pin.point,{autoPanOnFocus:false,icon,title:pin.title,zIndexOffset:pin.selected?1000:pin.spaces?800:0});
    marker.on('click',()=>{
      if(current.selectionEnabled===false&&!current.picking)return;
      if(!current.picking && pin.cluster){send({type:'pan'});send({type:'interaction'});moveCamera(pin.point,Math.min(19,map.getZoom()+1));}
      else select(pin.id,{lat:pin.point[0],lng:pin.point[1]});
    });
    return marker; });
  });
  const draft=next.draft||[];
  const outline=retain('draft-line',draft,()=>L.polyline(draft,{color:'#962e2b',weight:3,dashArray:'7 5',interactive:false}));
  const polygon=draft.length>2?retain('draft-area',draft,()=>L.polygon(draft,{color:'#962e2b',weight:1,fillOpacity:.12,interactive:false})):null;
  draft.forEach((p,index)=>{
    retain('vertex:'+index,[draft,next.drawing,next.cornerLabel],()=> { const marker=L.marker(p,{draggable:!!next.drawing,autoPan:true,zIndexOffset:3000,title:next.cornerLabel+(index+1),icon:L.divIcon({className:'zone-vertex',html:'<span></span>',iconSize:[44,44],iconAnchor:[22,22]})});
    marker.on('click',L.DomEvent.stopPropagation);
    marker.on('dragstart',()=>{dragging=true;});
    marker.on('drag',()=>{const point=marker.getLatLng();draft[index]=[point.lat,point.lng];outline.setLatLngs(draft);if(polygon)polygon.setLatLngs(draft);});
    marker.on('dragend',()=>{
      const point=marker.getLatLng();dragging=false;
      if(pending){pending.draft=draft;const queued=pending;pending=null;window.renderParking(queued);}
      send({type:'vertex',index,latitude:point.lat,longitude:point.lng});
    }); return marker; });
  });
  if(next.destinationMarker&&!next.drawing){
    const label=document.createElement('span');label.textContent=next.destinationName;
    retain('destination',[next.destinationMarker,next.destinationName],()=>L.marker(next.destinationMarker,{zIndexOffset:2000,title:next.destinationName,icon:L.divIcon({className:'destination-pin',html:'<span></span>',iconSize:[34,44],iconAnchor:[17,44]})}).on('click',()=>send({type:'interaction'})).bindTooltip(label,{permanent:true,direction:'top',offset:[0,-44],className:'destination-label'}));
  }
  layerCache.end();
  if(userDot)userDot.bringToFront();
  const key=next.destination.join(',')+':'+(next.cameraRevision||0)+':'+(next.cameraZoom??15);
  const selected=next.selectedId&&next.selectedAnchor?next.selectedId+':'+next.selectedAnchor.join(','):'';
  if(key!==destinationKey){const initial=!destinationKey;destinationKey=key;moveCamera(next.destination,next.cameraZoom??15,!initial&&!next.drawing);}
  else if(selected && selected!==selectionKey && !next.drawing && !next.picking)moveCamera(next.selectedAnchor,parkingSelectionZoom(map.getZoom(),Boolean(next.selectedPocSector)),false);
  selectionKey=selected;
  position();
};
window.addEventListener('resize',()=>{map.invalidateSize({pan:false});position();});
send({type:'ready'});
})();
</script></body></html>`;
