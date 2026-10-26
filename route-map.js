// Route map for outdoor activities imported from Strava (completed_rides.route_polyline, Google's
// encoded polyline format). Leaflet and the map tiles load only when a route is shown.
const LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
let leaflet = null;
function loadLeaflet(){
  if (leaflet) return leaflet;
  leaflet = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = LEAFLET + 'leaflet.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = LEAFLET + 'leaflet.js';
    js.onload = () => resolve(window.L);
    js.onerror = () => { leaflet = null; reject(new Error('Map library failed to load')); };
    document.head.appendChild(js);
  });
  return leaflet;
}

// Google polyline -> [[lat, lng], ...]
export function decodePolyline(str){
  const out = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length){
    for (const k of [0, 1]){
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && i < str.length);
      const d = (result & 1) ? ~(result >> 1) : (result >> 1);
      if (k === 0) lat += d; else lng += d;
    }
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

export const hasRoute = r => !!(r && r.route_polyline && r.route_polyline.length > 4);

// The panel to put in a detail page; mountRouteMap fills it.
export function routePanelHtml(){
  return '<div class="panel route-panel"><div class="panel-title"><span>Route</span></div><div class="route-map" role="img" aria-label="Map of the route"></div></div>';
}

export async function mountRouteMap(root, encoded, color = '#45D6C4'){
  const box = root && root.querySelector('.route-map');
  if (!box || !encoded) return;
  const pts = decodePolyline(encoded);
  if (pts.length < 2){ box.closest('.route-panel').remove(); return; }
  try {
    const L = await loadLeaflet();
    if (!box.isConnected) return;
    const map = L.map(box, { scrollWheelZoom:false, attributionControl:true, zoomControl:true });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19, subdomains:'abcd',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);
    const line = L.polyline(pts, { color, weight:4, opacity:.95, lineJoin:'round' }).addTo(map);
    L.circleMarker(pts[0], { radius:6, color:'#10141A', weight:2, fillColor:'#3DBE7A', fillOpacity:1 }).addTo(map).bindTooltip('Start');
    L.circleMarker(pts[pts.length-1], { radius:6, color:'#10141A', weight:2, fillColor:'#E5484D', fillOpacity:1 }).addTo(map).bindTooltip('Finish');
    map.fitBounds(line.getBounds(), { padding:[18, 18] });
  } catch(_){
    box.innerHTML = '<div class="empty-note" style="padding:16px">The map couldn\'t load. Check your connection.</div>';
  }
}

export const ROUTE_CSS = `
  .route-map{ height:340px; border-radius:10px; overflow:hidden; background:#0d1116; }
  @media (max-width:600px){ .route-map{ height:260px; } }
  .route-map .leaflet-control-attribution{ background:rgba(16,20,26,.75); color:#8C97A6; font-size:10px; }
  .route-map .leaflet-control-attribution a{ color:#B4BDC9; }
  .route-map .leaflet-bar a{ background:#1D242D; color:#E7ECF2; border-color:#2A323D; }
`;
