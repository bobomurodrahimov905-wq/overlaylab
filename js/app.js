"use strict";
/* global L, turf, proj4, shp, GeoTIFF */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt = (x, d = 1) => (x == null || !isFinite(x)) ? "—" : Number(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/,/g, " ");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("on"), 2200); }
async function busy(on, msg) { $("#busyT").textContent = msg || "Hisoblanmoqda…"; $("#busy").classList.toggle("on", on); if (on) await sleep(30); }
const RAMP = ["#3A2A7A", "#2D63B5", "#21A6B3", "#8EE08C", "#FFE46B"];
const RAMP_RGB = RAMP.map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));
function ramp(t) { t = Math.max(0, Math.min(1, t)) * 4; const i = Math.min(3, Math.floor(t)), f = t - i, a = RAMP_RGB[i], b = RAMP_RGB[i + 1]; return [0, 1, 2].map(k => Math.round(a[k] + (b[k] - a[k]) * f)); }

/* ---------- proyeksiyalar ---------- */
proj4.defs("LAEA", "+proj=laea +lat_0=41.5 +lon_0=64 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs");
proj4.defs("EPSG:3857", "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs");
for (let z = 38; z <= 45; z++) proj4.defs("EPSG:326" + z, `+proj=utm +zone=${z} +datum=WGS84 +units=m +no_defs`);
const toLaea = proj4("EPSG:4326", "LAEA");
const R = 6378137;
const merc = (lon, lat) => [R * lon * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
const imerc = (x, y) => [x / R * 180 / Math.PI, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI];
function mapCoords(g, f) { // geometriya koordinatalarini almaştiriş
  const m = c => typeof c[0] === "number" ? f(c) : c.map(m);
  if (g.type === "GeometryCollection") return { type: g.type, geometries: g.geometries.map(x => mapCoords(x, f)) };
  return { type: g.type, coordinates: m(g.coordinates) };
}
function planarAreaPerim(geom) { // LAEA da maydon (m²) va perimetr (m)
  let A = 0, P = 0;
  const ring = r => { let a = 0, p = 0; const q = r.map(c => toLaea.forward(c)); for (let i = 0; i < q.length - 1; i++) { a += q[i][0] * q[i + 1][1] - q[i + 1][0] * q[i][1]; p += Math.hypot(q[i + 1][0] - q[i][0], q[i + 1][1] - q[i][1]); } return [Math.abs(a) / 2, p]; };
  const poly = rings => rings.forEach((r, i) => { const [a, p] = ring(r); A += i ? -a : a; P += p; });
  if (geom.type === "Polygon") poly(geom.coordinates); else if (geom.type === "MultiPolygon") geom.coordinates.forEach(poly);
  return [A, P];
}
const isPoly = f => f && f.geometry && /Polygon/.test(f.geometry.type);
const isLine = f => f && f.geometry && /LineString/.test(f.geometry.type);
const isPoint = f => f && f.geometry && /Point/.test(f.geometry.type);

/* ---------- 3D xarita (deck.gl) ---------- */
const { Deck, MapView, GeoJsonLayer, SolidPolygonLayer, PathLayer, ColumnLayer, TextLayer, BitmapLayer, ScatterplotLayer, LightingEffect, AmbientLight, DirectionalLight, FlyToInterpolator, WebMercatorViewport } = deck;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const HOME = { longitude: 64.3, latitude: 40.2, zoom: 5.05, pitch: 50, bearing: -12 };
let VS = { longitude: 64.4, latitude: 41.4, zoom: 3.6, pitch: 0, bearing: 0, minZoom: 3, maxZoom: 12, maxPitch: 75 };
let IS3D = true, EXAG = 1, LABELS = true, ORBIT = false, EXT_METRIC = "plita", CITY = null;
let SLAB = 9000; // viloyat plitasi qalinligi, m (şahar rejimida yupqa)
/* --- relyef (ETOPO1, 10′) --- */
let DEMG = null; const VEXBASE = 14;
function demGrid() { if (DEMG) return DEMG; const d = window.__DATA__.dem, bin = atob(d.z), z = new Int16Array(bin.length / 2); for (let i = 0; i < z.length; i++) { const v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); z[i] = v > 32767 ? v - 65536 : v; } DEMG = { ...d, z }; return DEMG; }
function demAt(lon, lat) { const g = demGrid(); let x = (lon - g.lon0) / g.d, y = (g.lat0 - lat) / g.d; x = Math.max(0, Math.min(g.nx - 1.001, x)); y = Math.max(0, Math.min(g.ny - 1.001, y)); const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, Z = (i, j) => g.z[i * g.nx + j]; return (Z(y0, x0) * (1 - fx) + Z(y0, x0 + 1) * fx) * (1 - fy) + (Z(y0 + 1, x0) * (1 - fx) + Z(y0 + 1, x0 + 1) * fx) * fy; }
const RELIEF = () => EXT_METRIC === "relyef" && !CITY && IS3D;
const VEX = () => VEXBASE * EXAG;
const zb = (lon, lat) => RELIEF() ? Math.max(0, demAt(lon, lat)) * VEX() : SLAB; // sirt balandligi
const pz = (lon, lat) => RELIEF() ? Math.max(0, demAt(lon, lat)) * VEX() : 0;    // ustun asosi
const baseH = () => RELIEF() ? 0 : SLAB;
const HYPSO = [[-50, [52, 110, 170]], [0, [58, 98, 70]], [200, [74, 118, 76]], [500, [122, 140, 84]], [1000, [176, 156, 100]], [2000, [150, 112, 80]], [3000, [122, 100, 92]], [4000, [186, 184, 196]], [5000, [242, 244, 247]]];
function hypso(z) { if (z <= HYPSO[0][0]) return HYPSO[0][1]; for (let i = 1; i < HYPSO.length; i++) if (z <= HYPSO[i][0]) { const [a, ca] = HYPSO[i - 1], [b, cb] = HYPSO[i], t = (z - a) / (b - a); return ca.map((v, k) => Math.round(v + (cb[k] - v) * t)); } return HYPSO[HYPSO.length - 1][1]; }
const HZ = () => CITY ? .02 : 1; // şahar rejimida baland ustunlarni pasaytiriş
const hexA = (h, a = 1) => { h = String(h || "#888").replace("#", ""); if (h.length === 3) h = h.split("").map(c => c + c).join(""); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).concat([Math.round(255 * a)]); };
const lighting = new LightingEffect({ amb: new AmbientLight({ color: [255, 255, 255], intensity: 1.15 }), sun: new DirectionalLight({ color: [255, 244, 228], intensity: 1.5, direction: [-2, -5, -6] }), fill: new DirectionalLight({ color: [120, 160, 255], intensity: .45, direction: [4, 3, -2] }) });
const MAT = { ambient: .45, diffuse: .65, shininess: 36, specularColor: [70, 80, 95] };
const deckgl = new Deck({
  parent: $("#map"), views: new MapView({ repeat: false }), viewState: VS, controller: { dragRotate: true, touchRotate: true, inertia: 300 },
  effects: [lighting], layers: [], useDevicePixels: matchMedia('(max-width:760px)').matches ? Math.min(devicePixelRatio || 1, 1.5) : true, pickingRadius: 4, glOptions: { preserveDrawingBuffer: true }, deviceProps: { webgl: { preserveDrawingBuffer: true } },
  onViewStateChange: ({ viewState }) => { VS = viewState; deckgl.setProps({ viewState: VS }); hud(); return VS; },
  onHover: info => { if (info.coordinate) { const [lng, lat] = info.coordinate, z = Math.floor((lng + 180) / 6) + 1, u = proj4("EPSG:4326", "EPSG:326" + Math.min(45, Math.max(38, z)), [lng, lat]); $("#coords").textContent = `φ ${lat.toFixed(4)}°  λ ${lng.toFixed(4)}°  ·  UTM ${z}N  ${Math.round(u[0])} E  ${Math.round(u[1])} N`; } },
  getTooltip: info => tooltip(info),
  onClick: info => { if (info.object && info.layer && info.layer.props.onPickTable) info.layer.props.onPickTable(info); }
});
function tooltip({ object, layer }) {
  if (!object || !layer) return null;
  const p = layer.props.tipFn ? layer.props.tipFn(object) : (object.properties ? { title: layer.props.tipTitle || "", props: object.properties } : null);
  if (!p) return null;
  return { html: `<div class="tip"><b>${esc(p.title)}</b><table>${Object.entries(p.props || {}).filter(([k]) => !k.startsWith("_")).slice(0, 14).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(typeof v === "number" ? (Number.isInteger(v) ? v.toLocaleString("en-US").replace(/,/g, " ") : v.toFixed(3)) : v)}</td></tr>`).join("")}</table></div>`, style: { background: "rgba(13,23,36,.94)", border: "1px solid rgba(150,180,210,.25)", borderRadius: "10px", padding: "10px 12px", color: "#E9EEF2", boxShadow: "0 12px 30px rgba(0,0,0,.5)", maxWidth: "320px" } };
}
function setView(v, dur = 0) { VS = { ...VS, ...v, transitionDuration: dur, transitionInterpolator: dur ? new FlyToInterpolator({ speed: 1.3 }) : null }; deckgl.setProps({ viewState: VS }); hud(); }
const MOB = () => matchMedia("(max-width:760px)").matches;
function fitBBox(bb, extra = {}, maxZ = 9) {
  const el = $("#map"), W = el.clientWidth, H = el.clientHeight, panel = $("#panel").classList.contains("hide") || W < 900 ? 40 : 420, dr = $("#drawer").classList.contains("empty") || $("#drawer").classList.contains("closed") ? 60 : Math.min(H * .55, Math.max(Math.min(H * .42, 360), $("#drawer").offsetHeight + 30));
  const mob = MOB(), sheetH = mob ? Math.max($("#panel").getBoundingClientRect().height, $("#drawer").classList.contains("empty") ? 0 : $("#drawer").getBoundingClientRect().height) : 0;
  const pad = mob ? { left: 6, right: 6, top: 70, bottom: Math.min(sheetH + 16, H * .7) } : { left: Math.min(panel, W / 3), right: 60, top: 80, bottom: Math.min(dr, H * .55) };
  try { const vp = new WebMercatorViewport({ width: W, height: H }); const f = vp.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: pad, maxZoom: maxZ }); setView({ longitude: f.longitude, latitude: f.latitude + (mob && IS3D ? (bb[3] - bb[1]) * .16 : 0), zoom: f.zoom + (mob ? .2 : IS3D ? -.25 : 0), ...extra }, reduceMotion ? 0 : 1200); } catch (e) { console.warn(e); }
}
function hud() {
  $("#compass svg").style.transform = `rotate(${-VS.bearing}deg)`;
  $("#pitch").value = Math.round(VS.pitch); $("#pitchV").textContent = Math.round(VS.pitch) + "°";
  const mpp = 40075016.686 * Math.cos(VS.latitude * Math.PI / 180) / (512 * Math.pow(2, VS.zoom));
  const target = mpp * 110, nice = [1, 2, 5].flatMap(m => [1, 10, 100, 1000, 10000, 100000, 1000000].map(e => m * e)).sort((a, b) => a - b).filter(x => x <= target).pop() || 1;
  $("#scaleB").style.width = (nice / mpp) + "px"; $("#scaleT").textContent = (nice >= 1000 ? nice / 1000 + " km" : nice + " m") + (VS.pitch > 5 ? " · markazda" : "");
}
$("#compass").addEventListener("click", () => setView({ bearing: 0 }, 600));
$("#home").addEventListener("click", () => CITY ? exitCity() : MOB() ? fitBBox([55.9, 37.1, 73.2, 45.6], { pitch: IS3D ? 15 : 0, bearing: 0 }) : setView(IS3D ? HOME : { ...HOME, pitch: 0, bearing: 0 }, 1400));
$("#pitch").addEventListener("input", e => { setView({ pitch: +e.target.value }); if (+e.target.value > 0 && !IS3D) set3D(true, false); });
$("#exag").addEventListener("input", e => { EXAG = +e.target.value; exagLbl(); redraw(); });
function exagLbl() { $("#exagV").textContent = "×" + EXAG.toFixed(1) + (RELIEF() ? ` · relyef ×${Math.round(VEX())}` : ""); }
function set3D(on, move = true) { IS3D = on; $("#v3d").setAttribute("aria-pressed", on); $("#v2d").setAttribute("aria-pressed", !on); if (move) setView(on ? { pitch: 50, bearing: VS.bearing || -12 } : { pitch: 0, bearing: 0 }, 900); redraw(); }
$("#v2d").addEventListener("click", () => { set3D(false); commit("2D körinişi"); }); $("#v3d").addEventListener("click", () => { set3D(true); commit("3D körinişi"); });
$("#orbit").addEventListener("click", e => { ORBIT = !ORBIT; e.currentTarget.setAttribute("aria-pressed", ORBIT); e.currentTarget.classList.toggle("primary", ORBIT); if (ORBIT) { if (!IS3D) set3D(true); spin(); } });
function spin() { if (!ORBIT) return; VS = { ...VS, bearing: VS.bearing + .12, transitionDuration: 0, transitionInterpolator: null }; deckgl.setProps({ viewState: VS }); hud(); requestAnimationFrame(spin); }
$("#hidePanel").addEventListener("click", () => { $("#panel").classList.add("hide"); $("#coords").style.left = "14px"; $("#drawer").style.left = "14px"; });
$("#sheetBtn").addEventListener("click", () => $("#panel").classList.toggle("mini"));
if (MOB()) $("#panel").classList.add("mini");
$$(".tabs button").forEach(b => b.addEventListener("click", () => $("#panel").classList.remove("mini")));
$("#showPanel").addEventListener("click", () => { $("#panel").classList.remove("hide"); $("#coords").style.left = ""; $("#drawer").style.left = ""; });

/* ---------- qatlam reyestri ---------- */
const LAYERS = []; let uid = 0;
const PALETTE = ["#FF4F8B", "#B07CFF", "#FF9F43", "#2EE6C5", "#5BB8FF", "#F7D154"];
function popupHtml(p) { return `<table>${Object.entries(p || {}).filter(([k]) => !k.startsWith("_")).map(([k, v]) => `<tr><td>${esc(k)}</td><td><b>${esc(typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(3)) : v)}</b></td></tr>`).join("")}</table>`; }
function addLayer(name, fc, opt = {}) {
  const lay = { id: ++uid, name, fc, kind: opt.kind || "vector", derived: !!opt.derived, style: opt.style || { stroke: PALETTE[uid % PALETTE.length], fill: PALETTE[uid % PALETTE.length], fillOpacity: .4 }, styleFn: opt.styleFn, pointStyle: opt.pointStyle, visible: opt.visible !== false, note: opt.note || "", build: opt.build, bbox: opt.bbox || (fc && fc.features && fc.features.length ? turf.bbox(fc) : null), order: 0 };
  LAYERS.push(lay); renderLayers(); fillSelects(); redraw(); return lay;
}
function removeLayer(id) { const i = LAYERS.findIndex(l => l.id === id); if (i < 0) return; if (LAYERS[i]._city) { CITY = null; SLAB = 9000; } LAYERS.splice(i, 1); renderLayers(); fillSelects(); redraw(); }
const fitLayer = l => l && l.bbox && fitBBox(l.bbox);
function geomKind(fc) { const t = new Set((fc.features || []).map(f => f.geometry && f.geometry.type.replace("Multi", ""))); return [...t].join("/") || "—"; }
function swatch(l) { if (l.kind === "raster") return "linear-gradient(90deg," + RAMP.join(",") + ")"; return l.style.fill || l.style.stroke || "transparent"; }
function renderLayers() {
  $("#layerList").innerHTML = LAYERS.slice().reverse().map(l => `<div class="layer"><input type="checkbox" data-vis="${l.id}" ${l.visible ? "checked" : ""} aria-label="${esc(l.name)} körinişi"><span class="sw" style="background:${swatch(l)}"></span><span class="nm">${esc(l.name)}<small>${l.kind === "raster" ? esc(l.note) : geomKind(l.fc) + " · " + l.fc.features.length + " obyekt"}${l.derived ? " · natija" : ""}</small></span><span class="acts">${l.kind === "vector" ? `<button class="icon" data-tbl="${l.id}" title="Atribut jadvali">▦</button><button class="icon" data-dl="${l.id}" title="GeoJSON yuklab oliş">⬇</button>` : ""}${l.bbox ? `<button class="icon" data-zoom="${l.id}" title="Kattalaştiriş">⤢</button>` : ""}${l.derived ? `<button class="icon" data-del="${l.id}" title="Öçiriş">✕</button>` : ""}</span></div>`).join("");
}
$("#layerList").addEventListener("click", e => {
  const b = e.target.closest("button,input"); if (!b) return; const g = k => LAYERS.find(l => l.id === +b.dataset[k]);
  if (b.dataset.vis) { const l = g("vis"); l.visible = b.checked; redraw(); commit((b.checked ? "Yoqildi: " : "Yaşirildi: ") + l.name); }
  if (b.dataset.tbl) showTable(g("tbl"));
  if (b.dataset.zoom) fitLayer(g("zoom"));
  if (b.dataset.dl) { const l = g("dl"); download(slug(l.name) + ".json", JSON.stringify(l.fc)); }
  if (b.dataset.del) { const l = g("del"); removeLayer(+b.dataset.del); commit("Öçirildi: " + l.name); }
});
const slug = s => s.toLowerCase().replace(/[^a-z0-9ğşçö]+/gi, "_").replace(/^_|_$/g, "");
function fillSelects() {
  const vec = LAYERS.filter(l => l.kind === "vector");
  ["#vA", "#vB"].forEach((id, k) => { const el = $(id), cur = el.value; el.innerHTML = vec.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join(""); if (vec.some(l => String(l.id) === cur)) el.value = cur; else if (vec.length) el.value = k === 0 ? (vec.find(l => l.name === "Daryolar") || vec[0]).id : (vec.find(l => l.name === "Viloyatlar") || vec[0]).id; });
}
// Leaflet uslubidagi {color, fillColor, fillOpacity} → deck rangi
function featStyle(l, f) { if (l.styleFn) { const s = l.styleFn(f); return { fill: hexA(s.fillColor || l.style.fill, s.fillOpacity ?? l.style.fillOpacity ?? .4), line: hexA(s.color || l.style.stroke, s.opacity ?? 1), w: s.weight ?? 1.2 }; } return { fill: hexA(l.style.fill, l.style.fillOpacity ?? .4), line: hexA(l.style.stroke, 1), w: l.style.weight ?? 1.2 }; }
function liftFC(fc, z) { // çiziq va nuqtalarni plita ustiga köçiriş
  return { type: "FeatureCollection", features: fc.features.map(f => /Polygon/.test(f.geometry && f.geometry.type) ? f : { ...f, geometry: mapCoords(f.geometry, c => [c[0], c[1], z]) }) };
}
function drapeFC(fc, off) { return { type: "FeatureCollection", features: fc.features.map(f => f.geometry ? { ...f, geometry: mapCoords(f.geometry, c => [c[0], c[1], zb(c[0], c[1]) + off]) } : f) }; }
function vectorDeck(l, idx) {
  const rel = RELIEF(), lift = IS3D ? SLAB + 2500 + idx * 900 : 0;
  const key = IS3D + ":" + idx + ":" + SLAB + ":" + (rel ? EXAG : "-"); if (l._liftKey !== key) { l._lifted = rel ? drapeFC(l.fc, 1500 + idx * 600) : IS3D ? liftFC(l.fc, lift) : l.fc; l._liftKey = key; }
  return new GeoJsonLayer({
    id: "L" + l.id, data: l._lifted, pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 70],
    filled: true, stroked: true, extruded: IS3D && !rel, wireframe: false, material: MAT,
    getElevation: lift, getFillColor: f => featStyle(l, f).fill, getLineColor: f => featStyle(l, f).line, getLineWidth: f => featStyle(l, f).w,
    lineWidthUnits: "pixels", lineWidthMinPixels: 1, pointType: "circle", pointRadiusUnits: "pixels",
    getPointRadius: f => l.pointStyle ? l.pointStyle(f).radius : 5, pointBillboard: true,
    parameters: { depthCompare: IS3D && !rel ? "less-equal" : "always" },
    updateTriggers: { getFillColor: [l.styleV], getLineColor: [l.styleV] },
    tipTitle: l.name, onPickTable: () => showTable(l)
  });
}
function redraw() {
  const ctx = { is3D: IS3D, exag: EXAG }; const out = []; let di = 0;
  for (const l of LAYERS) { if (!l.visible) continue; if (l.build) out.push(...[].concat(l.build(ctx) || [])); else if (l.kind === "vector") out.push(vectorDeck(l, di++)); }
  deckgl.setProps({ layers: out.map(l => l.clone({ id: l.id + "@" + SLAB + (RELIEF() ? "r" + EXAG : "") })) });
}

/* ---------- jadval (pastki panel) ---------- */
let drawerCsv = null;
let DRAWER = null;
function setDrawer(title, sub, html, csv, bind) { DRAWER = { title, sub, html, csv, bind: bind || null }; const d = $("#drawer"); d.classList.remove("empty", "closed"); $("#dTitle").textContent = title; $("#dSub").textContent = sub || ""; $("#dBody").innerHTML = html; drawerCsv = csv || null; $("#dCsv").disabled = !csv; $("#dToggle").textContent = "▾"; if (MOB()) $("#panel").classList.add("mini"); }
$("#dToggle").addEventListener("click", () => { const c = $("#drawer").classList.toggle("closed"); $("#dToggle").textContent = c ? "▴" : "▾"; });
$("#dClose").addEventListener("click", () => $("#drawer").classList.add("empty"));
$("#dCsv").addEventListener("click", () => drawerCsv && download(drawerCsv[0], drawerCsv[1]));
function toCsv(head, rows) { const q = v => { const s = v == null ? "" : String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }; return "﻿" + [head, ...rows].map(r => r.map(q).join(",")).join("\n"); }
function showTable(l) {
  const fs = l.fc.features, keys = [...new Set(fs.flatMap(f => Object.keys(f.properties || {})))].filter(k => !k.startsWith("_"));
  const rows = fs.slice(0, 1000).map(f => keys.map(k => f.properties[k]));
  const html = `<div style="overflow:auto"><table class="t"><tr><th>#</th>${keys.map(k => `<th>${esc(k)}</th>`).join("")}</tr>${rows.map((r, i) => `<tr data-fi="${i}" style="cursor:pointer"><td class="num">${i + 1}</td>${r.map(v => `<td class="${typeof v === "number" ? "r num" : ""}">${esc(typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(3)) : v)}</td>`).join("")}</tr>`).join("")}</table></div>`;
  setDrawer(l.name, `${fs.length} obyekt · atribut jadvali · qatorni bosing — xaritada körsatiladi`, html, [slug(l.name) + ".csv", toCsv(keys, fs.map(f => keys.map(k => f.properties[k])))]);
  const bind = () => { $("#dBody").onclick = e => { const tr = e.target.closest("tr[data-fi]"); if (!tr) return; const f = fs[+tr.dataset.fi]; if (f.geometry) fitBBox(turf.bbox(f)); $$("#dBody tr").forEach(t => t.classList.toggle("sel", t === tr)); }; };
  bind(); DRAWER.bind = bind;
}

/* ---------- yuklab oliş ---------- */
let DL = null; (async () => { try { DL = window.claude && window.claude.use ? await window.claude.use("downloads") : null; } catch (e) { DL = null; } })();
async function download(name, data) {
  if (!DL) { toast("Bu körinişda fayl saqlaş mavjud emas"); return; }
  try { await DL.save({ filename: name, data }); } catch (e) { if (e && e.code === "declined") return; toast("Saqlab bölmadi: " + (e && e.message || e)); }
}

/* ---------- tayanç qatlamlar ---------- */
const D = window.__DATA__;
const LAY = {};
D.viloyatlar.features.forEach(f => { f.properties.maydon_km2 = +(planarAreaPerim(f.geometry)[0] / 1e6).toFixed(1); });
// viloyat körsatkiçlari (3D balandlik uçun): şahar aholisi, yöl ziçligi
(() => {
  const vp = D.viloyatlar.features;
  vp.forEach(p => { p.properties._aholi = 0; p.properties._yol = 0; });
  D.shaharlar.features.forEach(c => { const p = vp.find(v => turf.booleanPointInPolygon(c, v)); c._vil = p || null; if (p) p.properties._aholi += c.properties.aholi; });
  D.yollar.features.forEach(r => { const m = turf.along(r, turf.length(r) / 2); const p = vp.find(v => turf.booleanPointInPolygon(m, v)); if (p) p.properties._yol += turf.length(r); });
  vp.forEach(p => { p.properties._yolz = p.properties._yol / p.properties.maydon_km2 * 1000; p.properties._lbl = turf.pointOnFeature(p).geometry.coordinates; });
})();
function metricOf(p) { if (EXT_METRIC.startsWith("k:")) return +p["k_" + EXT_METRIC.slice(2)] || 0; switch (EXT_METRIC) { case "doimiy": return p.aholi || 0; case "ziclik": return p.ziclik || 0; case "aholi": return p._aholi; case "yol": return p._yolz; case "maydon": return p.maydon_km2; case "mcda": return p._mcda || 0; case "balandlik": return Math.max(0, p.bal_ort); default: return 0; } }
function vilHeight(p, mx) { return EXT_METRIC === "plita" || EXT_METRIC === "relyef" || !mx || CITY ? SLAB : SLAB + 140000 * EXAG * Math.sqrt(metricOf(p) / mx); }
const UZ = D.davlatlar.features.find(f => f.properties.kod === "UZB");
const GRAT = (() => { const g = []; for (let lon = 54; lon <= 76; lon += 2) g.push({ path: [[lon, 34], [lon, 48]] }); for (let lat = 36; lat <= 48; lat += 2) g.push({ path: [[52, lat], [78, lat]] }); return g; })();
const ringsOf = fs => fs.flatMap(f => { const g = f.geometry; return (g.type === "Polygon" ? [g.coordinates] : g.coordinates).map(p => ({ path: p[0], f })); });
const vilRings = ringsOf(D.viloyatlar.features), davRings = ringsOf(D.davlatlar.features.filter(f => f.properties.kod !== "UZB"));
const TERRAIN = (() => { const g = demGrid(), cells = []; for (let i = 0; i < g.ny; i++) { const lat = g.lat0 - i * g.d; if (lat < 35 || lat > 47.6) continue; for (let j = 0; j < g.nx; j++) { const lon = g.lon0 + j * g.d; if (lon < 53.5 || lon > 76.5) continue; const h = g.d / 2, z = g.z[i * g.nx + j]; cells.push({ z, c: [lon, lat], poly: [[lon - h, lat - h], [lon + h, lat - h], [lon + h, lat + h], [lon - h, lat + h]] }); } } return cells; })();
const uzRings = (() => { const g = UZ.geometry, polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates; return polys.map(p => ({ path: p[0] })); })();
LAY.dav = addLayer("Qöşni davlatlar", D.davlatlar, { style: { fill: "#1B2B3F", stroke: "#3A5370" }, build: ctx => [
  new PathLayer({ id: "grat", data: GRAT, getPath: d => d.path, getColor: [120, 160, 200, 40], getWidth: 1, widthUnits: "pixels" }),
  RELIEF() ? new PathLayer({ id: "davr", data: davRings, getPath: d => d.path.map(c => [c[0], c[1], zb(c[0], c[1]) + 600]), getColor: [150, 175, 200, 150], getWidth: 1, widthUnits: "pixels", parameters: { depthCompare: "always" } }) :
  new GeoJsonLayer({ id: "dav", data: { type: "FeatureCollection", features: D.davlatlar.features.filter(f => f.properties.kod !== "UZB") }, filled: true, stroked: true, getFillColor: [24, 39, 57, 235], getLineColor: [70, 98, 128, 255], lineWidthUnits: "pixels", getLineWidth: 1, pickable: true, tipTitle: "Davlat", parameters: { depthCompare: "always" } }),
  new TextLayer({ id: "davlbl", data: D.davlatlar.features.filter(f => f.properties.kod !== "UZB" && ["KAZ", "KGZ", "TJK", "TKM", "AFG"].includes(f.properties.kod)), getPosition: f => { const c = f._c || (f._c = turf.centerOfMass(f).geometry.coordinates); return RELIEF() ? [c[0], c[1], zb(c[0], c[1]) + 9000] : c; }, getText: f => f.properties.nomi.toUpperCase(), getSize: 11, getColor: [140, 165, 190, 150], fontFamily: "IBM Plex Mono, monospace", fontWeight: 500, characterSet: "auto", getTextAnchor: "middle", parameters: { depthCompare: "always" }, visible: LABELS })
] });
LAY.vil = addLayer("Viloyatlar", D.viloyatlar, { style: { fill: "#24384F", stroke: "#8FA7BD" }, build: ctx => {
  const mx = Math.max(...D.viloyatlar.features.map(f => metricOf(f.properties)));
  if (RELIEF()) return [
    new SolidPolygonLayer({ id: "terrain", data: TERRAIN, getPolygon: d => d.poly, extruded: true, material: { ambient: .5, diffuse: .7, shininess: 12, specularColor: [40, 40, 40] }, getElevation: d => Math.max(0, d.z) * VEX(), getFillColor: d => [...hypso(d.z), 255], pickable: true, tipFn: d => ({ title: "Relyef (ETOPO1)", props: { "balandlik, m": d.z, "φ, λ": d.c[1].toFixed(2) + "°, " + d.c[0].toFixed(2) + "°", katak: "10′ ≈ 14 × 18.5 km" } }) }),
    new PathLayer({ id: "vilr", data: vilRings, getPath: d => d.path.map(c => [c[0], c[1], zb(c[0], c[1]) + 500]), getColor: [235, 240, 245, 150], getWidth: 1, widthUnits: "pixels", pickable: true, tipFn: d => ({ title: d.f.properties.nomi, props: { "örtaça balandlik, m": d.f.properties.bal_ort, "min – maks, m": d.f.properties.bal_min + " – " + d.f.properties.bal_max } }), parameters: { depthCompare: "always" } }),
    new PathLayer({ id: "uzr", data: uzRings, getPath: d => d.path.map(c => [c[0], c[1], zb(c[0], c[1]) + 700]), getColor: [232, 196, 127, 255], getWidth: 2.4, widthUnits: "pixels", jointRounded: true, parameters: { depthCompare: "always" } }),
    new TextLayer({ id: "vlblr", data: LABELS ? D.viloyatlar.features : [], getPosition: f => [f.properties._lbl[0], f.properties._lbl[1], zb(f.properties._lbl[0], f.properties._lbl[1]) + 9000], getText: f => f.properties.nomi.replace(" viloyati", "").replace(" Resp.", ""), getSize: 12.5, getColor: [255, 255, 255, 235], fontFamily: "IBM Plex Sans, sans-serif", fontWeight: 600, characterSet: "auto", fontSettings: { sdf: true }, outlineWidth: 3, outlineColor: [8, 17, 27, 230], parameters: { depthCompare: "always" } })
  ];
  const colorOf = p => { if (EXT_METRIC === "plita" || !mx) return [38, 58, 82, 255]; const t = Math.sqrt(metricOf(p) / mx), c = ramp(t); return [c[0], c[1], c[2], 255]; };
  return [
    new GeoJsonLayer({ id: "vil", data: D.viloyatlar, filled: true, stroked: true, extruded: ctx.is3D, wireframe: ctx.is3D, material: MAT, getElevation: f => vilHeight(f.properties, mx), getFillColor: f => colorOf(f.properties), getLineColor: ctx.is3D ? [160, 190, 220, 120] : [143, 167, 189, 255], lineWidthUnits: "pixels", getLineWidth: 1, pickable: true, autoHighlight: true, highlightColor: [255, 79, 139, 90], parameters: { depthCompare: ctx.is3D ? "less-equal" : "always" }, tipFn: f => ({ title: f.properties.nomi, props: { ...(f.properties.aholi ? { "doimiy aholi": fmtI(f.properties.aholi), "ziçlik, kişi/km²": fmt(f.properties.ziclik, 1) } : {}), ...bazaTip(f.properties), "maydon, km²": f.properties.maydon_km2, "şahar aholisi": f.properties._aholi, "yöl ziçligi, km/1000 km²": +f.properties._yolz.toFixed(1), "örtaça balandlik, m": f.properties.bal_ort, "min – maks, m": f.properties.bal_min + " – " + f.properties.bal_max, ...(f.properties._mcda != null ? { "MCDA örtaça S": +f.properties._mcda.toFixed(3) } : {}), ISO: f.properties.iso } }), onPickTable: info => focusVil(info.object.properties.nomi), updateTriggers: { getElevation: [EXT_METRIC, ctx.exag], getFillColor: [EXT_METRIC] }, transitions: { getElevation: 700 } }),
    new PathLayer({ id: "uzline", data: uzRings, getPath: d => ctx.is3D ? d.path.map(c => [c[0], c[1], SLAB + 40]) : d.path, getColor: [232, 196, 127, 255], getWidth: 2.2, widthUnits: "pixels", jointRounded: true, parameters: { depthCompare: ctx.is3D ? "less-equal" : "always" } }),
    new TextLayer({ id: "vlbl", data: LABELS && !CITY ? D.viloyatlar.features : [], getPosition: f => [f.properties._lbl[0], f.properties._lbl[1], ctx.is3D ? vilHeight(f.properties, mx) + 6000 : 0], getText: f => f.properties.nomi.replace(" viloyati", "").replace(" Resp.", ""), getSize: 12.5, getColor: [233, 238, 242, 230], fontFamily: "IBM Plex Sans, sans-serif", fontWeight: 600, characterSet: "auto", fontSettings: { sdf: true }, outlineWidth: 3, outlineColor: [8, 17, 27, 220], parameters: { depthCompare: "always" }, updateTriggers: { getPosition: [EXT_METRIC, ctx.exag, ctx.is3D] } })
  ]; } });
/* ---------- tumanlar (geoBoundaries ADM2, 199 ta) ---------- */
const TUM = D.tumanlar.fc, TUMETA = D.tumanlar.meta;
const tumRings = TUM.features.flatMap(f => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates).map(p => ({ path: p[0], f })));
LAY.tum = addLayer("Tumanlar", TUM, { style: { fill: "#9FB8CF", stroke: "#C9D8E6" }, build: ctx => {
  if (CITY) return [];
  const rel = RELIEF(), z = c => !ctx.is3D ? 0 : rel ? zb(c[0], c[1]) + 450 : SLAB + 90;
  const key = ctx.is3D + ":" + rel + ":" + SLAB + ":" + EXAG;
  if (TUM._k !== key) { TUM._lift = { type: "FeatureCollection", features: TUM.features.map(f => ({ ...f, geometry: mapCoords(f.geometry, c => [c[0], c[1], z(c)]) })) }; TUM._k = key; }
  const pc = { depthCompare: "always" };
  return [
    new GeoJsonLayer({ id: "tum", data: TUM._lift, filled: true, stroked: false, extruded: false, getFillColor: [255, 255, 255, 6], pickable: true, autoHighlight: true, highlightColor: [255, 79, 139, 110], parameters: pc, tipFn: f => ({ title: f.properties.nomi + (f.properties.turi === "tuman" || f.properties.turi === "şahar tumani" ? " tumani" : ""), props: { viloyat: f.properties.viloyat, ...(f.properties.aholi ? { "doimiy aholi": fmtI(f.properties.aholi), "ziçlik, kişi/km²": fmt(f.properties.aholi / f.properties.maydon_km2, 1), "manba": "SIAT, " + (OCHIQ.yil || "") } : {}), "maydon, km²": f.properties.maydon_km2, birlik: f.properties.turi, "": "bosing → viloyat tumanlari" } }), onPickTable: info => focusVil(info.object.properties.viloyat) }),
    new PathLayer({ id: "tumr", data: tumRings, getPath: d => d.path.map(c => [c[0], c[1], z(c) + 20]), getColor: [214, 226, 238, 95], getWidth: .8, widthUnits: "pixels", parameters: pc, updateTriggers: { getPath: [key] } })
  ]; } });
LAY.kol = addLayer("Köllar va suv omborlari", D.kollar, { style: { fill: "#2C77B8", stroke: "#5BB8FF" }, build: ctx => [new GeoJsonLayer({ id: "kol", data: D.kollar, filled: true, stroked: true, extruded: ctx.is3D, getElevation: f => { if (!RELIEF()) return SLAB + 300; const c = f._cc || (f._cc = turf.pointOnFeature(f).geometry.coordinates); return zb(c[0], c[1]) + 250; }, material: MAT, getFillColor: [44, 119, 184, 235], getLineColor: [91, 184, 255, 255], lineWidthUnits: "pixels", getLineWidth: 1, pickable: true, tipTitle: "Suv havzasi", onPickTable: () => showTable(LAY.kol), parameters: { depthCompare: ctx.is3D ? "less-equal" : "always" } })] });
const riverPaths = D.daryolar.features.flatMap(f => (f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates).map(p => ({ path: p, f })));
LAY.dar = addLayer("Daryolar", D.daryolar, { style: { fill: "#5BB8FF", stroke: "#5BB8FF" }, build: ctx => { const rel = RELIEF(), P = d => d.path.map(c => [c[0], c[1], !ctx.is3D ? 0 : rel ? zb(c[0], c[1]) + 600 : SLAB + 200]); const pc = { depthCompare: ctx.is3D ? "less-equal" : "always" }; return [
  new PathLayer({ id: "dar-glow", data: riverPaths, getPath: P, getColor: [91, 184, 255, 60], getWidth: 7, widthUnits: "pixels", jointRounded: true, capRounded: true, parameters: pc }),
  new PathLayer({ id: "dar", data: riverPaths, getPath: P, getColor: [140, 210, 255, 255], getWidth: 2, widthUnits: "pixels", jointRounded: true, capRounded: true, pickable: true, tipFn: d => ({ title: d.f.properties.nomi, props: { turi: d.f.properties.turi } }), parameters: pc })]; } });
const roadPaths = D.yollar.features.map(f => ({ path: f.geometry.coordinates, f }));
LAY.yol = addLayer("Avtomobil yöllari", D.yollar, { style: { fill: "#E9A24E", stroke: "#E9A24E" }, build: ctx => [new PathLayer({ id: "yol", data: roadPaths, getPath: d => ctx.is3D ? d.path.map(c => [c[0], c[1], RELIEF() ? zb(c[0], c[1]) + 450 : SLAB + 120]) : d.path, getColor: d => d.f.properties.turi === "magistral" ? [233, 162, 78, 230] : [233, 162, 78, 130], getWidth: d => d.f.properties.turi === "magistral" ? 1.8 : 1, widthUnits: "pixels", pickable: true, tipFn: d => ({ title: "Yöl: " + d.f.properties.turi, props: { "uzunlik, km": d.f.properties.uzunlik_km } }), parameters: { depthCompare: ctx.is3D ? "less-equal" : "always" } })] });
let popMax = Math.max(...D.shaharlar.features.map(f => f.properties.aholi));
LAY.sha = addLayer("Şaharlar", D.shaharlar, { style: { fill: "#F2D49B", stroke: "#F2D49B" }, build: ctx => {
  const h = f => baseH() + 160000 * ctx.exag * (RELIEF() ? .45 : 1) * Math.sqrt(f.properties.aholi / popMax), cz = f => pz(f.geometry.coordinates[0], f.geometry.coordinates[1]);
  const base = ctx.is3D && !CITY ? [new ColumnLayer({ id: "sha3d", data: D.shaharlar.features, getPosition: f => [f.geometry.coordinates[0], f.geometry.coordinates[1], cz(f)], diskResolution: 24, radius: 6500, extruded: true, material: MAT, getElevation: h, getFillColor: f => f.properties.maqomi === "poytaxt" ? [255, 79, 139, 255] : [242, 212, 155, 255], pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 120], tipFn: f => ({ title: f.properties.nomi, props: { aholi: f.properties.aholi, maqomi: f.properties.maqomi, "balandlik, m (ETOPO1)": f.properties.balandlik_m } }), onPickTable: info => focusCity(info.object.properties.nomi), updateTriggers: { getElevation: [ctx.exag] } })]
    : [new ScatterplotLayer({ id: "sha2d", data: D.shaharlar.features, getPosition: f => ctx.is3D ? [f.geometry.coordinates[0], f.geometry.coordinates[1], zb(f.geometry.coordinates[0], f.geometry.coordinates[1]) + 80] : f.geometry.coordinates, onPickTable: info => focusCity(info.object.properties.nomi), updateTriggers: { getPosition: [ctx.is3D] }, getRadius: f => 2.5 + Math.sqrt(f.properties.aholi) / 230, radiusUnits: "pixels", getFillColor: f => f.properties.maqomi === "poytaxt" ? [255, 79, 139, 255] : [242, 212, 155, 255], getLineColor: [8, 17, 27, 255], stroked: true, lineWidthUnits: "pixels", getLineWidth: 1, pickable: true, tipFn: f => ({ title: f.properties.nomi, props: { aholi: f.properties.aholi, maqomi: f.properties.maqomi } }), parameters: { depthCompare: "always" } })];
  if (LABELS && !CITY) base.push(new TextLayer({ id: "shalbl", data: D.shaharlar.features.filter(f => f.properties.aholi >= 200000), getPosition: f => [f.geometry.coordinates[0], f.geometry.coordinates[1], ctx.is3D ? cz(f) + h(f) + 4000 : 0], getText: f => f.properties.nomi, getSize: 11.5, getPixelOffset: ctx.is3D ? [0, -8] : [0, -12], getColor: [242, 212, 155, 255], fontFamily: "IBM Plex Sans, sans-serif", fontWeight: 500, characterSet: "auto", fontSettings: { sdf: true }, outlineWidth: 3, outlineColor: [8, 17, 27, 230], parameters: { depthCompare: "always" }, updateTriggers: { getPosition: [ctx.exag, ctx.is3D] } }));
  return base; } });
$("#lblToggle").addEventListener("change", e => { LABELS = e.target.checked; redraw(); });
$("#extMetric").addEventListener("change", e => { EXT_METRIC = e.target.value; if (EXT_METRIC === "mcda" && !RES) toast("Avval MCDA tahlilini bajaring"); if (CITY && EXT_METRIC === "relyef") toast("Relyef modeli butun mamlakat körinişida işlaydi"); if (!IS3D && EXT_METRIC !== "plita") set3D(true); if (EXT_METRIC === "relyef") setView({ pitch: Math.max(VS.pitch, 55) }, 900); exagLbl(); redraw(); legendExt(); });
function legendExt() {
  if (EXT_METRIC === "plita") { if (!RES) $("#legend").classList.remove("on"); return; }
  if (EXT_METRIC === "relyef") { setLegend(`<h4>Dengiz sathidan balandlik</h4><div class="ramp" style="background:linear-gradient(90deg,${HYPSO.slice(1).map(h => "rgb(" + h[1] + ")").join(",")})"></div><div class="lr"><span>0</span><span>1000</span><span>3000</span><span>5000 m</span></div><p class="small muted">ETOPO1, 10′ katak (~18 km). Vertikal masştab ×${Math.round(VEX())}.</p>`); return; }
  const nm = EXT_METRIC.startsWith("k:") ? (BAZA.defs.find(d => "k:" + d.k === EXT_METRIC) || { nomi: EXT_METRIC }).nomi : { doimiy: "Doimiy aholi (baza)", ziclik: "Aholi ziçligi, kişi/km² (baza)", aholi: "Şahar aholisi (viloyat)", yol: "Yöl ziçligi, km/1000 km²", maydon: "Maydon, km²", mcda: "MCDA örtaça S", balandlik: "Örtaça balandlik, m (ETOPO1)" }[EXT_METRIC];
  setLegend(`<h4>Balandlik va rang</h4><div>${nm}</div><div class="ramp" style="background:linear-gradient(90deg,${RAMP.join(",")})"></div><div class="lr"><span>kam</span><span>köp</span></div><p class="small muted">Balandlik ∝ √qiymat</p>`);
}


/* ---------- şahar çegaralari ---------- */
const CB = D.chegaralar;
const fmtI = v => v == null ? "—" : Math.round(v).toLocaleString("en-US").replace(/,/g, " ");
const citySelFill = () => $("#citySel").innerHTML = `<option value="">— şaharni tanlang —</option>` + D.shaharlar.features.slice().sort((a, b) => b.properties.aholi - a.properties.aholi).map(f => `<option value="${esc(f.properties.nomi)}">${esc(f.properties.nomi)} · ${fmtI(f.properties.aholi)}</option>`).join("");
citySelFill();
$("#citySel").addEventListener("change", e => e.target.value && focusCity(e.target.value));
const VILN = D.viloyatlar.features.map(f => f.properties.nomi);
VILN.forEach(v => { const fs = TUM.features.filter(f => f.properties.viloyat === v), m = TUMETA[v]; if (!fs.length || !m) return;
  const nt = fs.filter(f => f.properties.turi !== "şahar").length, ns = fs.length - nt;
  CB["vil:" + v] = { vil: v, kind: v === "Toşkent şahri" ? `poytaxt · ${nt} ta tuman` : `viloyat · ${nt} ta tuman${ns ? " + " + ns + " ta şahar" : ""}`, note: "", km2: m.km2, perim_km: m.perim_km, urban: null, urban_km2: null,
    units: fs.slice().sort((a, b) => (a.properties.turi === "şahar") - (b.properties.turi === "şahar") || a.properties.nomi.localeCompare(b.properties.nomi)).map(f => ({ name: f.properties.nomi, turi: f.properties.turi, km2: f.properties.maydon_km2, geom: f.geometry, f })) }; });
$("#vilSel").innerHTML = `<option value="">— viloyatni tanlang —</option>` + VILN.slice().sort((a, b) => a.localeCompare(b)).map(v => `<option value="${esc(v)}">${esc(v)} · ${TUMETA[v] ? TUMETA[v].n : 0} ta birlik</option>`).join("");
$("#vilSel").addEventListener("change", e => e.target.value && focusVil(e.target.value));
function focusVil(v) { return focusCity("vil:" + v); }
function focusCity(name) {
  const c = CB[name]; if (!c) return toast(name + " uçun çegara topilmadi");
  const old = LAYERS.find(l => l._city); if (old) removeLayer(old.id);
  const isVil = !!c.vil, key = name; if (isVil) name = c.vil;
  CITY = key; SLAB = 300; $("#citySel").value = isVil ? "" : name; $("#vilSel").value = isVil ? name : "";
  const fc = { type: "FeatureCollection", features: c.units.map((u, i) => ({ type: "Feature", properties: { nomi: u.name, maydon_km2: u.km2, ...(u.turi ? { turi: u.turi } : {}), _i: i }, geometry: u.geom })) };
  const outer = c.units.length > 1 ? (dissolveAll(fc.features) || fc.features[0]) : fc.features[0];
  const rings = []; const g = outer.geometry; (g.type === "Polygon" ? [g.coordinates] : g.coordinates).forEach(p => rings.push({ path: p[0] }));
  const urb = c.urban ? { type: "FeatureCollection", features: [{ type: "Feature", properties: { nomi: "Qurilgan hudud (MODIS)" }, geometry: c.urban }] } : null;
  const vilF = isVil ? D.viloyatlar.features.find(f => f.properties.nomi === name) : null;
  const city = isVil ? { geometry: { coordinates: turf.pointOnFeature(outer).geometry.coordinates } } : D.shaharlar.features.find(f => f.properties.nomi === name);
  const unitWord = u => isVil ? (u.turi === "şahar" ? "şahar" : "tuman") : "tuman";
  const multi = c.units.length > 1, isTuman = c.kind.startsWith("tuman");
  const UC0 = [[255, 79, 139], [176, 124, 255], [91, 184, 255], [46, 230, 197], [255, 159, 67], [247, 209, 84]];
  const hsl = h => { const f = n => { const k = (n + h / 30) % 12, a = .62 * Math.min(.6, 1 - .6); return Math.round(255 * (.6 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); }; return [f(0), f(8), f(4)]; };
  const UC = isVil ? c.units.map((u, i) => hsl((i * 137.5 + 330) % 360)) : UC0;
  const lid = "city" + (uid + 1);
  const lay = addLayer(`${isVil ? "Viloyat" : "Şahar"}: ${name}`, fc, { derived: true, style: { fill: "#FF4F8B", stroke: "#FF4F8B" }, build: ctx => {
    const top = ctx.is3D ? SLAB : 0, hgt = i => top + (ctx.is3D ? 260 + (i % 3) * 140 : 0), pc = { depthCompare: ctx.is3D ? "less-equal" : "always" };
    const L = [];
    if (urb) L.push(new GeoJsonLayer({ id: lid + "u", data: urb, filled: true, stroked: true, extruded: ctx.is3D, getElevation: top + 60, getFillColor: [232, 196, 127, 70], getLineColor: [232, 196, 127, 200], lineWidthUnits: "pixels", getLineWidth: 1, material: MAT, pickable: true, tipFn: () => ({ title: "Qurilgan hudud", props: { "maydon, km²": c.urban_km2, manba: "Natural Earth / MODIS 2002–2003, 1 km" } }), parameters: pc }));
    L.push(new GeoJsonLayer({ id: lid, data: fc, filled: true, stroked: true, extruded: ctx.is3D, wireframe: ctx.is3D, material: MAT, getElevation: f => hgt(f.properties._i), getFillColor: f => multi ? [...UC[f.properties._i % UC.length], 175] : [255, 79, 139, 120], getLineColor: [255, 255, 255, 220], lineWidthUnits: "pixels", getLineWidth: 1.5, pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 90], tipFn: f => ({ title: f.properties.nomi + (multi && f.properties.turi !== "şahar" ? " tumani" : ""), props: { "maydon, km²": f.properties.maydon_km2, birlik: isVil ? (f.properties.turi === "şahar" ? "viloyatga böysunuvçi şahar" : "tuman") + " · " + name : c.kind } }), parameters: pc, transitions: reduceMotion ? {} : { getElevation: { duration: 900, enter: () => [top] } } }));
    const zt = (multi ? top + 700 : hgt(0)) + 30;
    L.push(new PathLayer({ id: lid + "g", data: rings, getPath: d => d.path.map(p => [p[0], p[1], zt]), getColor: [255, 79, 139, 80], getWidth: 12, widthUnits: "pixels", jointRounded: true, parameters: { depthCompare: "always" } }));
    L.push(new PathLayer({ id: lid + "o", data: rings, getPath: d => d.path.map(p => [p[0], p[1], zt]), getColor: [255, 210, 228, 255], getWidth: 2.5, widthUnits: "pixels", jointRounded: true, parameters: { depthCompare: "always" } }));
    if (multi) L.push(new TextLayer({ id: lid + "t", data: fc.features, getPosition: f => { const p = f._p || (f._p = turf.pointOnFeature(f).geometry.coordinates); return [p[0], p[1], hgt(f.properties._i) + 80]; }, getText: f => f.properties.nomi, getSize: 12, getColor: [255, 255, 255, 240], fontFamily: "IBM Plex Sans, sans-serif", fontWeight: 600, characterSet: "auto", fontSettings: { sdf: true }, outlineWidth: 3, outlineColor: [8, 17, 27, 230], parameters: { depthCompare: "always" } }));
    L.push(new TextLayer({ id: lid + "n", data: [city], getPosition: f => [f.geometry.coordinates[0], f.geometry.coordinates[1], zt + 600], getText: () => (isVil ? name.replace(" viloyati", "").replace(" Resp.", "") : name).toUpperCase(), getSize: 22, getPixelOffset: [0, -26], getColor: [255, 255, 255, 255], fontFamily: "IBM Plex Mono, monospace", fontWeight: 600, characterSet: "auto", fontSettings: { sdf: true }, outlineWidth: 4, outlineColor: [255, 79, 139, 255], parameters: { depthCompare: "always" } }));
    return L; } });
  lay._city = key;
  const doFit = () => { if (!IS3D) fitBBox(turf.bbox(fc), {}, 12.5); else fitBBox(turf.bbox(fc), { pitch: isVil ? 45 : 55, bearing: -20 }, 12.5); };
  const pop = !isVil && city ? city.properties.aholi : null;
  const unitRows = c.units.map((u, i) => `<tr data-ui="${i}" style="cursor:pointer"><td><span class="sw" style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;background:rgb(${UC[i % UC.length].join(",")})"></span>${esc(u.name)}${isVil && u.turi === "şahar" ? ' <small class="muted">şahar</small>' : ""}</td><td class="r num">${fmt(u.km2, 1)}</td>${isVil ? `<td class="r num">${u.f && u.f.properties.aholi ? fmtI(u.f.properties.aholi) : "—"}</td>` : ""}<td style="width:30%"><div class="bar"><i style="width:${u.km2 / Math.max(...c.units.map(x => x.km2)) * 100}%"></i></div></td></tr>`).join("");
  const html = `<div class="row" style="justify-content:space-between"><span class="pill ${isTuman ? "wa" : "ok"}">${esc(c.kind)}</span><span class="row"><button class="btn sm" id="cityGj" type="button">⬇ GeoJSON</button><button class="btn sm" id="cityBack" type="button">← Butun Özbekiston</button></span></div>
  <div class="kpis"><div class="kpi"><b class="num">${fmt(c.km2, 1)}</b><span>maydon, km² (LAEA)</span></div><div class="kpi"><b class="num">${fmt(c.perim_km, 1)}</b><span>perimetr, km</span></div>${isVil ? `<div class="kpi"><b class="num">${fmtI(vilF ? vilF.properties.aholi : null)}</b><span>doimiy aholi${OCHIQ.ok ? " · SIAT " + OCHIQ.yil : ""}</span></div><div class="kpi"><b class="num">${c.units.filter(u => u.turi !== "şahar").length}</b><span>tuman</span></div><div class="kpi"><b class="num">${c.units.filter(u => u.turi === "şahar").length}</b><span>viloyatga böysunuvçi şahar</span></div><div class="kpi"><b class="num">${vilF ? vilF.properties.bal_ort : "—"}</b><span>örtaça balandlik, m (ETOPO1)</span></div>` : `<div class="kpi"><b class="num">${c.urban_km2 != null ? fmt(c.urban_km2, 1) : "—"}</b><span>qurilgan hudud, km² (MODIS)</span></div><div class="kpi"><b class="num">${fmtI(pop)}</b><span>aholi (aglomeratsiya, NE)</span></div>`}${!isTuman && pop ? `<div class="kpi"><b class="num">${fmtI(pop / c.km2)}</b><span>kiş/km² (ma’muriy çegarada)</span></div>` : ""}</div>
  ${c.note ? `<p class="small" style="color:var(--warn)">⚠ ${esc(c.note)}</p>` : ""}${isTuman ? `<p class="small" style="color:var(--warn)">⚠ Manbada ${esc(name)} şahri alohida ma’muriy birlik sifatida yöq — u joylaşgan tuman çegarasi körsatilgan.</p>` : ""}
  ${multi ? `<table class="t"><tr><th>${isVil ? "Tuman / şahar" : "Tuman"}</th><th class="r">maydon, km²</th>${isVil ? '<th class="r">aholi</th>' : ""}<th></th></tr>${unitRows}</table>` : ""}
  ${isVil ? `<p class="small muted">Çegara: geoBoundaries gbOpen UZB ADM2 (manba OCHA ROCCA, 2020; CC BY 3.0 IGO), soddalaştirilgan (~400 m). Maydon — çegara geometriyasidan LAEA proyeksiyasida hisoblangan. Aholi — ${OCHIQ.ok ? `SIAT (Milliy statistika qömitasi), ${OCHIQ.sana} holatiga, SOATO kodi bilan bog‘langan` : "oflayn nusxa"}.${(OCHIQ.yoq[name] || []).length ? ` ⚠ Bu viloyatda 2020-yildan keyin tuzilgan, xaritada çegarasi hali yöq birliklar: ${OCHIQ.yoq[name].map(r => esc(r.nomi) + " (" + fmtI(r.qiymat * 1000) + " kişi)").join(", ")}.` : ""} Jadvaldagi qatorni bossangiz, öşa tumanga yaqinlaşadi.</p>` : `: Natural Earth urban areas (MODIS 2002–2003, 1 km). Aholi — Natural Earth POP_MAX (aglomeratsiya baholaşi), şuning uçun ziçlik taxminiy. Qurilgan hudud ma’muriy çegaradan katta bölişi mumkin: şahar atrofidagi qişloqlar ham kiradi.</p>`}`;
  setDrawer(name, `${isVil ? esc(c.kind) : c.units.length > 1 ? c.units.length + " ta tuman" : esc(c.units[0].name)} · haqiqiy çegara`, html, [(isVil ? "viloyat_" : "shahar_") + slug(name) + ".csv", toCsv(isVil ? ["nomi", "turi", "maydon_km2"] : ["birlik", "maydon_km2"], c.units.map(u => isVil ? [u.name, u.turi, u.km2] : [u.name, u.km2]))]);
  const bind = () => { $("#cityBack").onclick = exitCity;
    $("#cityGj").onclick = () => download((isVil ? "viloyat_" : "shahar_") + slug(name) + ".json", JSON.stringify(fc));
    $("#dBody").onclick = e => { const tr = e.target.closest("tr[data-ui]"); if (!tr) return; fitBBox(turf.bbox(fc.features[+tr.dataset.ui]), {}, 13); $$("#dBody tr").forEach(t => t.classList.toggle("sel", t === tr)); }; };
  bind(); DRAWER.bind = bind;
  doFit();
  commit((isVil ? "Viloyat: " : "Şahar: ") + name);
}
function exitCity() { const old = LAYERS.find(l => l._city); if (old) removeLayer(old.id); CITY = null; SLAB = 9000; $("#citySel").value = ""; $("#vilSel").value = ""; $("#drawer").classList.add("empty"); redraw(); setView(IS3D ? HOME : { ...HOME, pitch: 0, bearing: 0 }, 1600); commit("Butun Özbekiston"); }

/* ---------- panel tablar ---------- */
$$(".tabs button").forEach(b => b.addEventListener("click", () => { $$(".tabs button").forEach(x => x.setAttribute("aria-selected", x === b)); $$(".pane").forEach(p => p.classList.toggle("on", p.id === b.dataset.p)); if (b.dataset.p === "p-rep") buildReport(); }));
function setLegend(html) { const l = $("#legend"); l.innerHTML = html; l.classList.add("on"); }

/* ---------- kirişdagi kamera harakati ---------- */
setTimeout(() => { if (MOB()) fitBBox([55.9, 37.1, 73.2, 45.6], { pitch: 15, bearing: 0 }); else setView(HOME, reduceMotion ? 0 : 3200); }, 350);
setTimeout(() => $("#intro").classList.add("out"), 1300);
setTimeout(() => $("#intro").remove(), 3000);
hud();

/* =========================================================
   VEKTOR OVERLAY
   ========================================================= */
const fcOf = fs => turf.featureCollection(fs);
function bboxHit(a, b) { return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]); }
function mergeProps(pa, pb) { const o = { ...pa }; for (const [k, v] of Object.entries(pb || {})) { o[k in o ? k + "_B" : k] = v; } return o; }
function cleanPolys(fs) { return fs.filter(isPoly).map(f => turf.feature(f.geometry, { ...f.properties })); }
function safe(fn) { try { return fn(); } catch (e) { console.warn(e); return null; } }
function dissolveAll(fs) {
  const p = cleanPolys(fs); if (!p.length) return null; if (p.length === 1) return p[0];
  // ikkilik daraxt böyiça birlaştiriş (tezroq va barqarorroq)
  let cur = p; while (cur.length > 1) { const nx = []; for (let i = 0; i < cur.length; i += 2) nx.push(i + 1 < cur.length ? (safe(() => turf.union(fcOf([cur[i], cur[i + 1]]))) || cur[i]) : cur[i]); cur = nx; }
  return cur[0];
}
function overlayCore(op, A, B) {
  const a = cleanPolys(A), b = cleanPolys(B), out = [];
  const ab = a.map(f => turf.bbox(f)), bb = b.map(f => turf.bbox(f));
  const inter = () => { for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) { if (!bboxHit(ab[i], bb[j])) continue; const r = safe(() => turf.intersect(fcOf([a[i], b[j]]))); if (r) out.push(turf.feature(r.geometry, mergeProps(a[i].properties, b[j].properties))); } };
  const minus = (X, Y, tag) => { const u = dissolveAll(Y); const ub = u && turf.bbox(u); X.forEach(x => { if (!u || !bboxHit(turf.bbox(x), ub)) { out.push(turf.feature(x.geometry, { ...x.properties, _src: tag })); return; } const r = safe(() => turf.difference(fcOf([x, u]))); if (r) out.push(turf.feature(r.geometry, { ...x.properties, _src: tag })); }); };
  if (op === "intersect") inter();
  else if (op === "erase") minus(a, b, "A");
  else if (op === "clip") { const u = dissolveAll(b); if (u) { const ub = turf.bbox(u); a.forEach((x, i) => { if (!bboxHit(ab[i], ub)) return; const r = safe(() => turf.intersect(fcOf([x, u]))); if (r) out.push(turf.feature(r.geometry, { ...x.properties })); }); } }
  else if (op === "identity") { inter(); minus(a, b, "A"); }
  else if (op === "union") { inter(); minus(a, b, "A"); minus(b, a, "B"); }
  else if (op === "symdiff") { minus(a, b, "A"); minus(b, a, "B"); }
  return out;
}
function bufferFs(fs, km, diss) {
  if (diss) { // bir turdagi geometriyalarni bitta Multi* ga yiğib, bir marta buferlaş (JSTS içida birlaşadi)
    const grp = { Point: [], LineString: [], Polygon: [] };
    fs.forEach(f => { const g = f.geometry; if (!g) return; const t = g.type.replace("Multi", ""); (g.type.startsWith("Multi") ? g.coordinates : [g.coordinates]).forEach(c => grp[t].push(c)); });
    const parts = Object.entries(grp).filter(([, c]) => c.length).map(([t, c]) => safe(() => turf.buffer(turf.feature({ type: "Multi" + t, coordinates: c }), km, { units: "kilometers", steps: 16 }))).filter(Boolean);
    const u = parts.length > 1 ? dissolveAll(parts) : parts[0]; return u ? [turf.feature(u.geometry, { bufer_km: km })] : [];
  }
  const bf = fs.map(f => safe(() => turf.buffer(f, km, { units: "kilometers", steps: 12 }))).filter(Boolean).map(f => turf.feature(f.geometry, { ...f.properties, bufer_km: km }));
  if (!diss) return bf; const u = dissolveAll(bf); return u ? [turf.feature(u.geometry, { bufer_km: km })] : [];
}
function sjoin(A, B, field) {
  const polys = cleanPolys(B), pb = polys.map(f => turf.bbox(f));
  return polys.map((p, j) => {
    let n = 0, sum = 0, len = 0;
    A.forEach(f => {
      if (isPoint(f)) { const pts = f.geometry.type === "Point" ? [f.geometry.coordinates] : f.geometry.coordinates; pts.forEach(c => { if (c[0] < pb[j][0] || c[0] > pb[j][2] || c[1] < pb[j][1] || c[1] > pb[j][3]) return; if (turf.booleanPointInPolygon(c, p)) { n++; const v = +f.properties[field]; if (isFinite(v)) sum += v; } }); }
      else if (isLine(f)) { if (!bboxHit(turf.bbox(f), pb[j])) return; const lines = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates; lines.forEach(cs => { const ln = turf.lineString(cs); const parts = safe(() => turf.lineSplit(ln, p)); const segs = parts && parts.features.length ? parts.features : [ln]; segs.forEach(s => { const c = s.geometry.coordinates, m = turf.along(s, turf.length(s) / 2); if (turf.booleanPointInPolygon(m, p)) { len += turf.length(s); n++; } }); }); }
    });
    const props = { ...p.properties, soni: n }; if (field) props[field + "_yigindi"] = +sum.toFixed(2); if (len) props.uzunlik_km = +len.toFixed(1);
    return turf.feature(p.geometry, props);
  });
}
function dissolveBy(fs, field) {
  const g = {}; cleanPolys(fs).forEach(f => { const k = f.properties[field] ?? "—"; (g[k] = g[k] || []).push(f); });
  return Object.entries(g).map(([k, arr]) => { const u = dissolveAll(arr); return u ? turf.feature(u.geometry, { [field]: k, birlaşgan: arr.length }) : null; }).filter(Boolean);
}
function enrich(fs) { // maydon, perimetr, Polsby-Popper, sliver
  const ppT = +$("#ppThr").value, aT = +$("#slThr").value;
  fs.forEach(f => { if (!isPoly(f)) return; const [A, P] = planarAreaPerim(f.geometry); const sph = turf.area(f) / 1e6; f.properties.maydon_km2 = +(A / 1e6).toFixed(3); f.properties.maydon_sfer_km2 = +sph.toFixed(3); f.properties.perimetr_km = +(P / 1000).toFixed(2); const pp = P > 0 ? 4 * Math.PI * A / (P * P) : 0; f.properties.polsby_popper = +pp.toFixed(4); f.properties.sliver = (pp < ppT && A / 1e6 < aT) ? "ha" : "yöq"; });
  return fs;
}
function filterFs(fs, expr) { if (!expr || !expr.includes("=")) return fs; const [k, v] = expr.split("=").map(s => s.trim()); const vs = v.split("|").map(s => s.trim()); return fs.filter(f => vs.includes(String(f.properties[k]))); }
const OP_NAME = { intersect: "Intersect", union: "Union", erase: "Erase", symdiff: "Sym. difference", identity: "Identity", clip: "Clip", buffer: "Buffer", sjoin: "Spatial join", dissolve: "Dissolve" };
const HELP = {
  intersect: "A va B ikkalasida bor qism; atributlar ikkalasidan (takrorlanganiga _B qöşiladi).", union: "Hamma qism, kesişgan joylar alohida.", erase: "A dan B ostidagi qism olib taşlanadi.", symdiff: "Faqat bitta qatlamda bor joylar.", identity: "A töliq saqlanadi, B çegaralari böyiça bölinadi.", clip: "A, B ning birlaştirilgan çegarasi böyiça kesiladi; B atributlari qöşilmaydi.",
  buffer: "Parametr — masofa, km. A ning har bir obyekti atrofida zona.", sjoin: "A (nuqta yoki çiziq) B poligonlariga biriktiriladi: soni, maydon yiğindisi (guruh maydoni), çiziq uzunligi.", dissolve: "A poligonlari “Dissolve / guruh maydoni” böyiça birlaştiriladi."
};
function updHelp() { const op = $("#vOp").value; $("#vHelp").textContent = HELP[op]; $("#vBwrap").style.opacity = ["buffer", "dissolve"].includes(op) ? .4 : 1; }
$("#vOp").addEventListener("change", updHelp); updHelp();

const RUNS = []; // hisobot uçun
async function runVector(op, A, B, opts = {}) {
  const t0 = performance.now(); let fs;
  const af = filterFs(A.fc.features, opts.filter);
  if (!af.length) throw new Error("A qatlamda filtrga mos obyekt yöq");
  if (op === "buffer") fs = bufferFs(af, opts.param, opts.diss);
  else if (op === "sjoin") fs = sjoin(af, B.fc.features, opts.field);
  else if (op === "dissolve") { if (!opts.field) throw new Error("Dissolve uçun maydon nomini kiriting"); fs = dissolveBy(af, opts.field); }
  else { if (!af.some(isPoly) || !B.fc.features.some(isPoly)) throw new Error("Bu amal uçun ikkala qatlam ham poligon bölişi kerak (çiziq/nuqtani avval Buffer qiling)"); fs = overlayCore(op, af, B.fc.features); }
  enrich(fs);
  const ms = performance.now() - t0;
  return { fs, ms };
}
function summarize(name, op, fs, ms, group, extra) {
  const polys = fs.filter(isPoly), tot = polys.reduce((s, f) => s + f.properties.maydon_km2, 0), totS = polys.reduce((s, f) => s + f.properties.maydon_sfer_km2, 0);
  const sl = polys.filter(f => f.properties.sliver === "ha");
  let html = `<div class="kpis"><div class="kpi"><b class="num">${fs.length}</b><span>natija obyekt</span></div>${polys.length ? `<div class="kpi"><b class="num">${fmt(tot, 0)}</b><span>jami maydon, km² (LAEA)</span></div><div class="kpi"><b class="num">${fmt(Math.abs(tot - totS) / Math.max(tot, 1e-9) * 100, 2)}%</b><span>sferik hisob bilan farq</span></div><div class="kpi"><b class="num">${sl.length}</b><span>sliver (${fmt(sl.reduce((s, f) => s + f.properties.maydon_km2, 0), 2)} km²)</span></div>` : ""}<div class="kpi"><b class="num">${fmt(ms, 0)}</b><span>ms hisoblaş vaqti</span></div></div>`;
  let rows = [], head = [];
  if (group && polys.length) {
    const g = {}; polys.forEach(f => { const k = f.properties[group] ?? "—"; g[k] = (g[k] || 0) + f.properties.maydon_km2; });
    const base = {}; D.viloyatlar.features.forEach(f => base[f.properties.nomi] = f.properties.maydon_km2);
    const ent = Object.entries(g).sort((a, b) => b[1] - a[1]), mx = ent[0] ? ent[0][1] : 1;
    head = [group, "maydon_km2", "ulush_%"];
    rows = ent.map(([k, v]) => [k, +v.toFixed(1), base[k] ? +(v / base[k] * 100).toFixed(1) : ""]);
    html += `<table class="t"><tr><th>${esc(group)}</th><th class="r">maydon, km²</th><th class="r">${Object.keys(base).length ? "hudud uluşi" : ""}</th><th></th></tr>${rows.map(r => `<tr><td>${esc(r[0])}</td><td class="r num">${fmt(r[1], 1)}</td><td class="r num">${r[2] !== "" ? fmt(r[2], 1) + "%" : ""}</td><td style="width:30%"><div class="bar"><i style="width:${r[1] / mx * 100}%"></i></div></td></tr>`).join("")}</table>`;
  } else if (extra) { head = extra.head; rows = extra.rows; html += extra.html; }
  setDrawer(name, `${OP_NAME[op] || op} · ${fs.length} obyekt`, html, rows.length ? [slug(name) + ".csv", toCsv(head, rows)] : null);
  RUNS.push({ name, op, n: fs.length, area: tot, slivers: sl.length, ms, rows: rows.slice(0, 20), head, time: new Date() });
}
function resultStyle(color) { return { stroke: color, fill: color, fillOpacity: .45, weight: 1.2 }; }
const slStyle = color => f => f.properties.sliver === "ha" ? { color: "#000", weight: 2, fillColor: "#FFEB3B", fillOpacity: .9 } : { color, weight: 1.1, fillColor: color, fillOpacity: .45 };
$("#vRun").addEventListener("click", async () => {
  const op = $("#vOp").value, A = LAYERS.find(l => l.id === +$("#vA").value), B = LAYERS.find(l => l.id === +$("#vB").value);
  if (!A) return toast("A qatlamni tanlang");
  await busy(true, `${OP_NAME[op]} bajarilmoqda…`);
  try {
    const { fs, ms } = await runVector(op, A, B, { param: +$("#vParam").value, filter: $("#vFilt").value, field: $("#vField").value.trim(), diss: $("#vDiss").checked });
    const name = `${OP_NAME[op]}: ${A.name}${["buffer", "dissolve"].includes(op) ? "" : " × " + B.name}`, col = PALETTE[(uid + 1) % PALETTE.length];
    const lay = addLayer(name, fcOf(fs), { derived: true, style: resultStyle(col), styleFn: slStyle(col) });
    $("#vLog").textContent = `✓ ${name}\n${fs.length} obyekt · ${fmt(ms, 0)} ms`;
    const grp = $("#vField").value.trim() || (fs[0] && fs[0].properties.nomi !== undefined ? "nomi" : "");
    if (op === "sjoin") sjoinTable(name, fs, $("#vField").value.trim(), ms); else summarize(name, op, fs, ms, grp && op !== "dissolve" ? grp : "");
    fitLayer(lay); commit(name);
  } catch (e) { $("#vLog").textContent = "✕ " + e.message; toast(e.message); }
  await busy(false);
});
function sjoinTable(name, fs, field, ms) {
  const k2 = field ? field + "_yigindi" : null, hasLen = fs.some(f => f.properties.uzunlik_km);
  const rows = fs.map(f => [f.properties.nomi ?? f.properties.name ?? "", f.properties.soni, k2 ? f.properties[k2] : "", hasLen ? (f.properties.uzunlik_km || 0) : "", f.properties.maydon_km2, hasLen ? +((f.properties.uzunlik_km || 0) / f.properties.maydon_km2 * 1000).toFixed(2) : (k2 ? +((f.properties[k2] || 0) / f.properties.maydon_km2).toFixed(2) : "")]).sort((a, b) => (b[2] || b[3] || b[1]) - (a[2] || a[3] || a[1]));
  const head = ["hudud", "soni", k2 || "", hasLen ? "uzunlik_km" : "", "maydon_km2", hasLen ? "zichlik_km_1000km2" : (k2 ? "zichlik_1km2" : "")];
  const html = `<table class="t"><tr><th>hudud</th><th class="r">soni</th>${k2 ? `<th class="r">${esc(k2)}</th>` : ""}${hasLen ? `<th class="r">uzunlik, km</th>` : ""}<th class="r">maydon, km²</th><th class="r">${hasLen ? "km / 1000 km²" : k2 ? "1 km² ga" : ""}</th></tr>${rows.map(r => `<tr><td>${esc(r[0])}</td><td class="r num">${r[1]}</td>${k2 ? `<td class="r num">${fmt(r[2], 0)}</td>` : ""}${hasLen ? `<td class="r num">${fmt(r[3], 1)}</td>` : ""}<td class="r num">${fmt(r[4], 0)}</td><td class="r num">${r[5] !== "" ? fmt(r[5], 2) : ""}</td></tr>`).join("")}</table>`;
  summarize(name, "sjoin", fs, ms, "", { head, rows, html });
}

/* --- real stsenariylar --- */
const PRESETS = [
  { t: "Toşqin xavfi zonasi", d: "Amudaryo va Sirdaryo atrofida 10 km bufer → viloyatlar bilan Intersect: har viloyatda xavf ostidagi maydon.", run: async () => {
      const buf = (await runVector("buffer", LAY.dar, null, { param: 10, filter: "nomi=Amudaryo|Sirdaryo", diss: true })).fs;
      const bl = addLayer("Bufer 10 km: Amudaryo, Sirdaryo", fcOf(buf), { derived: true, style: { stroke: "#1E5DAF", fill: "#1E5DAF", fillOpacity: .15, weight: 1 } });
      const { fs, ms } = await runVector("intersect", LAY.vil, bl, {});
      const l = addLayer("Toşqin zonasi × viloyatlar", fcOf(fs), { derived: true, styleFn: slStyle("#B8125A"), style: resultStyle("#B8125A") });
      summarize("Toşqin zonasi × viloyatlar", "intersect", fs, ms, "nomi"); return l; } },
  { t: "Transport qamrovidan taşqari hududlar", d: "Avtomobil yöllaridan 30 km bufer → viloyatlardan Erase: yöl tarmoği yetib bormagan maydon.", run: async () => {
      const buf = (await runVector("buffer", LAY.yol, null, { param: 30, diss: true })).fs;
      const bl = addLayer("Bufer 30 km: yöllar", fcOf(buf), { derived: true, style: { stroke: "#8A4B1F", fill: "#8A4B1F", fillOpacity: .12, weight: .8 } });
      const { fs, ms } = await runVector("erase", LAY.vil, bl, {});
      const l = addLayer("Yöldan 30 km dan uzoq hududlar", fcOf(fs), { derived: true, styleFn: slStyle("#C25E00"), style: resultStyle("#C25E00") });
      summarize("Yöldan 30 km dan uzoq hududlar", "erase", fs, ms, "nomi"); return l; } },
  { t: "Şaharlar va aholi viloyatlar kesimida", d: "Spatial join (point-in-polygon): har viloyatdagi şaharlar soni va aholisi, ziçlik.", run: async () => {
      const { fs, ms } = await runVector("sjoin", LAY.sha, LAY.vil, { field: "aholi" });
      const mx = Math.max(...fs.map(f => f.properties.aholi_yigindi || 0));
      const l = addLayer("Şahar aholisi × viloyatlar", fcOf(fs), { derived: true, style: resultStyle("#7A3FB0"), styleFn: f => ({ color: "#4C5A5E", weight: .8, fillColor: "#7A3FB0", fillOpacity: .08 + .75 * Math.sqrt((f.properties.aholi_yigindi || 0) / mx) }) });
      sjoinTable("Şahar aholisi × viloyatlar", fs, "aholi", ms); return l; } },
  { t: "Yöl tarmoği ziçligi", d: "Line-in-polygon: yöllar viloyat çegarasida kesilib, har viloyatdagi uzunlik va ziçlik (km / 1000 km²) hisoblanadi.", run: async () => {
      const { fs, ms } = await runVector("sjoin", LAY.yol, LAY.vil, {});
      const mx = Math.max(...fs.map(f => (f.properties.uzunlik_km || 0) / f.properties.maydon_km2));
      const l = addLayer("Yöl ziçligi × viloyatlar", fcOf(fs), { derived: true, style: resultStyle("#8A4B1F"), styleFn: f => ({ color: "#4C5A5E", weight: .8, fillColor: "#8A4B1F", fillOpacity: .08 + .75 * ((f.properties.uzunlik_km || 0) / f.properties.maydon_km2) / mx }) });
      sjoinTable("Yöl ziçligi × viloyatlar", fs, "", ms); return l; } },
  { t: "Orol inqirozi ta’sir zonasi", d: "Janubiy Orol atrofida 100 km bufer → viloyatlar bilan Clip va Intersect: qaysi hududlar ta’sir zonasida.", run: async () => {
      const buf = (await runVector("buffer", LAY.kol, null, { param: 100, filter: "nomi=Janubiy Orol", diss: true })).fs;
      const bl = addLayer("Bufer 100 km: Janubiy Orol", fcOf(buf), { derived: true, style: { stroke: "#00796B", fill: "#00796B", fillOpacity: .12, weight: 1 } });
      const { fs, ms } = await runVector("intersect", LAY.vil, bl, {});
      const l = addLayer("Orol zonasi × viloyatlar", fcOf(fs), { derived: true, styleFn: slStyle("#00796B"), style: resultStyle("#00796B") });
      summarize("Orol zonasi × viloyatlar", "intersect", fs, ms, "nomi"); return l; } }
];
$("#presets").innerHTML = PRESETS.map((p, i) => `<button class="preset" type="button" data-pr="${i}"><span class="n">0${i + 1}</span><b>${p.t}</b><span>${p.d}</span></button>`).join("");
$("#presets").addEventListener("click", async e => { const b = e.target.closest("[data-pr]"); if (!b) return; const p = PRESETS[+b.dataset.pr]; await busy(true, p.t + "…"); try { const l = await p.run(); $("#vLog").textContent = "✓ " + p.t; fitLayer(l); commit(p.t); } catch (er) { console.error(er); $("#vLog").textContent = "✕ " + er.message; } await busy(false); });

/* =========================================================
   FAYL YUKLAŞ
   ========================================================= */
const drop = $("#drop");
["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => handleFiles([...e.dataTransfer.files]));
$("#fileIn").addEventListener("change", e => { const fl = [...e.target.files]; e.target.value = ""; handleFiles(fl); });
const USER_RASTERS = [];
async function handleFiles(files) {
  for (const f of files) {
    const ext = f.name.split(".").pop().toLowerCase();
    await busy(true, f.name + " öqilmoqda…");
    try {
      if (ext === "json" || ext === "geojson") {
        let gj = JSON.parse(await f.text());
        if (gj.type === "Feature") gj = fcOf([gj]); if (gj.type !== "FeatureCollection") throw new Error("FeatureCollection kutilgan edi");
        const crs = gj.crs && gj.crs.properties && gj.crs.properties.name || ""; const m = crs.match(/(\d{4,5})$/);
        if (m && m[1] !== "4326" && m[1] !== "84") { const code = "EPSG:" + m[1]; if (!proj4.defs(code)) throw new Error(code + " qöllab-quvvatlanmaydi"); const tr = proj4(code, "EPSG:4326"); gj.features.forEach(ft => ft.geometry = mapCoords(ft.geometry, c => tr.forward(c))); delete gj.crs; }
        addLayer(f.name.replace(/\.(geo)?json$/i, ""), gj, { derived: true });
      } else if (ext === "zip") {
        if (typeof shp === "undefined") throw new Error("Shapefile kutubxonasi yuklanmadi");
        let gj = await shp(await f.arrayBuffer()); (Array.isArray(gj) ? gj : [gj]).forEach(g => addLayer(g.fileName || f.name.replace(/\.zip$/i, ""), g, { derived: true }));
      } else if (ext === "tif" || ext === "tiff") await loadTiff(f);
      else throw new Error("Format qöllab-quvvatlanmaydi: ." + ext);
      toast(f.name + " qöşildi");
    } catch (e) { console.error(e); toast("Xato: " + e.message); }
    await busy(false);
  }
  fitLayer(LAYERS[LAYERS.length - 1]); commit("Fayl: " + files.map(f => f.name).join(", "));
}
async function loadTiff(file) {
  if (typeof GeoTIFF === "undefined") throw new Error("GeoTIFF kutubxonasi yuklanmadi");
  const tiff = await GeoTIFF.fromArrayBuffer(await file.arrayBuffer()), img = await tiff.getImage();
  const w = img.getWidth(), h = img.getHeight(), bb = img.getBoundingBox(), gk = img.getGeoKeys() || {};
  const epsg = gk.ProjectedCSTypeGeoKey || gk.GeographicTypeGeoKey || 4326, code = "EPSG:" + epsg;
  if (!proj4.defs(code)) throw new Error(code + " qöllab-quvvatlanmaydi (4326, 3857, 326xx)");
  const ras = (await img.readRasters({ samples: [0] }))[0];
  const nod = img.getGDALNoData(); const res = [(bb[2] - bb[0]) / w, (bb[3] - bb[1]) / h];
  const r = { name: file.name.replace(/\.tiff?$/i, ""), w, h, bb, code, data: ras, nodata: nod, res, unit: epsg === 4326 ? "°" : "m" };
  let mn = Infinity, mx = -Infinity; for (let i = 0; i < ras.length; i++) { const v = ras[i]; if (v === nod || !isFinite(v)) continue; if (v < mn) mn = v; if (v > mx) mx = v; } r.min = mn; r.max = mx;
  r.sample = (lon, lat) => { const p = code === "EPSG:4326" ? [lon, lat] : proj4("EPSG:4326", code, [lon, lat]); const c = Math.floor((p[0] - bb[0]) / res[0]), rr = Math.floor((bb[3] - p[1]) / res[1]); if (c < 0 || rr < 0 || c >= w || rr >= h) return NaN; const v = ras[rr * w + c]; return (v === nod || !isFinite(v)) ? NaN : v; };
  USER_RASTERS.push(r);
  // körsatiş: 3857 da qayta namunalaş → BitmapLayer
  const ll = code === "EPSG:4326" ? [[bb[0], bb[1]], [bb[2], bb[3]]] : [proj4(code, "EPSG:4326", [bb[0], bb[1]]), proj4(code, "EPSG:4326", [bb[2], bb[3]])];
  const lon0 = Math.min(ll[0][0], ll[1][0]), lon1 = Math.max(ll[0][0], ll[1][0]), lat0 = Math.min(ll[0][1], ll[1][1]), lat1 = Math.max(ll[0][1], ll[1][1]);
  const [x0, y0] = merc(lon0, lat1), [x1, y1] = merc(lon1, lat0); const DW = Math.min(900, w), DH = Math.max(1, Math.round(DW * (y0 - y1) / (x1 - x0)));
  const cv = document.createElement("canvas"); cv.width = DW; cv.height = DH; const g = cv.getContext("2d"), im = g.createImageData(DW, DH);
  for (let i = 0; i < DH; i++) for (let j = 0; j < DW; j++) { const [lo, la] = imerc(x0 + (j + .5) / DW * (x1 - x0), y0 - (i + .5) / DH * (y0 - y1)); const v = r.sample(lo, la); if (isNaN(v)) continue; im.data.set([...ramp((v - mn) / (mx - mn || 1)), 225], (i * DW + j) * 4); }
  g.putImageData(im, 0, 0);
  const lid = "tif" + (++uid);
  addLayer(r.name, null, { kind: "raster", derived: true, note: `raster · ${w}×${h} · ${code} · ${fmt(mn, 1)}…${fmt(mx, 1)}`, bbox: [lon0, lat0, lon1, lat1], build: ctx => { const z = ctx.is3D && !RELIEF() ? SLAB + 600 : 0; return [new BitmapLayer({ id: lid, image: cv, bounds: [[lon0, lat0, z], [lon0, lat1, z], [lon1, lat1, z], [lon1, lat0, z]], opacity: .88, textureParameters: { minFilter: "nearest", magFilter: "nearest" }, parameters: { depthCompare: "always" } })]; } });
  addUserCriterion(r);
}

/* =========================================================
   MCDA
   ========================================================= */
const SAATY = [9, 8, 7, 6, 5, 4, 3, 2, 1, 1 / 2, 1 / 3, 1 / 4, 1 / 5, 1 / 6, 1 / 7, 1 / 8, 1 / 9];
const RI = [0, 0, 0, .58, .90, 1.12, 1.24, 1.32, 1.41, 1.45, 1.49];
const fr = v => v >= 1 ? String(Math.round(v)) : "1/" + Math.round(1 / v);
const MPRESET = {
  logi: { t: "Logistika markazi uçun joy", crit: [
      { id: "yol", on: true, dir: "near", a: 2, b: 40 }, { id: "shahar", on: true, dir: "near", a: 10, b: 150 }, { id: "nishablik", on: true, dir: "near", a: .5, b: 4 }, { id: "daryo", on: true, dir: "far", a: 3, b: 15 }, { id: "kol", on: true, dir: "far", a: 2, b: 25 }, { id: "balandlik", on: false, dir: "near", a: 500, b: 2000 }],
    ahp: { "yol,shahar": 2, "yol,nishablik": 3, "yol,daryo": 4, "yol,kol": 5, "shahar,nishablik": 2, "shahar,daryo": 3, "shahar,kol": 4, "nishablik,daryo": 2, "nishablik,kol": 3, "daryo,kol": 2, "yol,balandlik": 4, "shahar,balandlik": 3, "nishablik,balandlik": 2, "daryo,balandlik": 1, "kol,balandlik": 1 } },
  agro: { t: "Suğoriladigan dehqonçilik klasteri", crit: [
      { id: "daryo", on: true, dir: "near", a: 5, b: 80 }, { id: "balandlik", on: true, dir: "near", a: 300, b: 1500 }, { id: "nishablik", on: true, dir: "near", a: .3, b: 3 }, { id: "shahar", on: true, dir: "near", a: 15, b: 120 }, { id: "yol", on: true, dir: "near", a: 3, b: 30 }, { id: "kol", on: false, dir: "far", a: 2, b: 20 }],
    ahp: { "daryo,balandlik": 2, "daryo,nishablik": 3, "daryo,shahar": 4, "daryo,yol": 5, "daryo,kol": 6, "balandlik,nishablik": 2, "balandlik,shahar": 3, "balandlik,yol": 4, "balandlik,kol": 5, "nishablik,shahar": 2, "nishablik,yol": 3, "nishablik,kol": 4, "shahar,yol": 2, "shahar,kol": 3, "yol,kol": 2 } }
};
const CDEF = { yol: "Avtomobil yöliga masofa", shahar: "Şaharga masofa (≥100 ming aholi)", daryo: "Daryoga masofa", kol: "Suv havzasiga masofa", balandlik: "Dengiz sathidan balandlik (ETOPO1)", nishablik: "Nişablik (ETOPO1 dan)" };
const CUNIT = { balandlik: "m", nishablik: "°" };
let M = { preset: "logi", crit: [], ahp: {}, man: {} };
function loadPreset(k) { const p = MPRESET[k]; M.preset = k; M.crit = p.crit.map(c => ({ ...c, name: CDEF[c.id], unit: CUNIT[c.id] || "km" })); USER_RASTERS.forEach(r => M.crit.push(userCrit(r))); M.ahp = { ...p.ahp }; M.man = {}; renderCrit(); renderW(); }
function userCrit(r) { const id = "u_" + r.name; return { id, name: r.name + " (GeoTIFF)", dir: "near", a: +r.min.toFixed(2), b: +r.max.toFixed(2), on: true, unit: r.unit === "°" ? "qiymat" : "qiymat", raster: r }; }
function addUserCriterion(r) { const base = userCrit(r); M.crit.push(base); if (/dem|srtm|elev|baland/i.test(r.name)) { base.on = false; const s = userCrit(r); s.id = "s_" + r.name; s.name = r.name + " → nişablik, °"; s.slope = true; s.a = 2; s.b = 15; s.unit = "°"; M.crit.push(s); } renderCrit(); renderW(); toast("GeoTIFF MCDA mezoni sifatida qöşildi"); }
function renderCrit() {
  $("#mCrit").innerHTML = M.crit.map((c, i) => `<div class="crit${c.on ? "" : " off"}"><header><label class="row"><input type="checkbox" data-ci="${i}" data-k="on" ${c.on ? "checked" : ""}><b>${esc(c.name)}</b></label><span class="small muted mono">${c.unit}</span></header><div class="grid2" style="grid-template-columns:1.2fr 1fr 1fr"><label class="f">Yönalişi<select data-ci="${i}" data-k="dir"><option value="near"${c.dir === "near" ? " selected" : ""}>kam — yaxşi</option><option value="far"${c.dir === "far" ? " selected" : ""}>köp — yaxşi</option></select></label><label class="f">a<input type="number" step="any" data-ci="${i}" data-k="a" value="${c.a}"></label><label class="f">b<input type="number" step="any" data-ci="${i}" data-k="b" value="${c.b}"></label></div></div>`).join("");
}
$("#mCrit").addEventListener("change", e => { const t = e.target, i = t.dataset.ci; if (i == null) return; const c = M.crit[+i], k = t.dataset.k; c[k] = k === "on" ? t.checked : k === "dir" ? t.value : +t.value; if (k === "on") { renderCrit(); renderW(); } });
const active = () => M.crit.filter(c => c.on);
function ahpCalc(ids) {
  const n = ids.length, A = ids.map((a, i) => ids.map((b, j) => i === j ? 1 : (M.ahp[a + "," + b] ?? (M.ahp[b + "," + a] ? 1 / M.ahp[b + "," + a] : 1))));
  const gm = A.map(r => Math.pow(r.reduce((x, y) => x * y, 1), 1 / n)), s = gm.reduce((x, y) => x + y, 0), w = gm.map(x => x / s);
  const lmax = A.map((r, i) => r.reduce((t, a, j) => t + a * w[j], 0) / w[i]).reduce((x, y) => x + y, 0) / n;
  const CI = n > 2 ? (lmax - n) / (n - 1) : 0, CR = RI[n] ? CI / RI[n] : 0; return { A, w, lmax, CI, CR };
}
function weights() {
  const ac = active(); if (!ac.length) return [];
  if ($('input[name="wm"]:checked').value === "ahp") return ahpCalc(ac.map(c => c.id)).w;
  const raw = ac.map(c => M.man[c.id] ?? 1), s = raw.reduce((a, b) => a + b, 0) || 1; return raw.map(x => x / s);
}
function renderW() {
  const ac = active(), mode = $('input[name="wm"]:checked').value, box = $("#mW");
  if (ac.length < 2) { box.innerHTML = `<p class="small muted">Kamida 2 ta mezon yoqing.</p>`; return; }
  if (mode === "ahp") {
    const r = ahpCalc(ac.map(c => c.id));
    let h = `<div style="overflow:auto"><table class="ahp"><tr><th></th>${ac.map((c, j) => `<th title="${esc(c.name)}">${j + 1}</th>`).join("")}<th>w</th></tr>`;
    ac.forEach((a, i) => { h += `<tr><th style="text-align:left" title="${esc(a.name)}">${i + 1}. ${esc(a.name.slice(0, 16))}</th>`; ac.forEach((b, j) => { if (i === j) h += `<td>1</td>`; else if (i < j) { const v = r.A[i][j]; h += `<td><select data-p="${a.id},${b.id}">${SAATY.map(s => `<option value="${s}"${Math.abs(s - v) < 1e-6 ? " selected" : ""}>${fr(s)}</option>`).join("")}</select></td>`; } else h += `<td class="rec">${fr(r.A[i][j])}</td>`; }); h += `<td class="num"><b>${r.w[i].toFixed(3)}</b></td></tr>`; });
    h += `</table></div><p class="row small"><span class="pill ${r.CR < .1 ? "ok" : "no"}">CR = ${r.CR.toFixed(3)} ${r.CR < .1 ? "< 0.10 izçil" : "≥ 0.10 — qayta köring"}</span><span class="muted mono">λmax ${r.lmax.toFixed(3)} · CI ${r.CI.toFixed(4)} · RI ${RI[ac.length].toFixed(2)}</span></p>`;
    box.innerHTML = h;
    $$("#mW select").forEach(s => s.addEventListener("change", e => { const [a, b] = e.target.dataset.p.split(","); M.ahp[a + "," + b] = +e.target.value; delete M.ahp[b + "," + a]; renderW(); }));
  } else {
    const w = weights();
    box.innerHTML = ac.map((c, i) => `<div class="wcell"><label class="f">${esc(c.name)}<input type="range" min="0" max="10" step=".1" value="${M.man[c.id] ?? 1}" data-m="${c.id}"></label><span class="num" data-wv="${c.id}">${w[i].toFixed(3)}</span></div>`).join("");
    $$("#mW input").forEach(s => s.addEventListener("input", e => { M.man[e.target.dataset.m] = +e.target.value; const w2 = weights(); active().forEach((c, i) => { const el = $(`[data-wv="${c.id}"]`); if (el) el.textContent = w2[i].toFixed(3); }); }));
  }
}
$$('input[name="wm"]').forEach(r => r.addEventListener("change", renderW));
$("#mPreset").addEventListener("change", e => loadPreset(e.target.value));
function aggParam() { const a = $("#mAgg").value; $("#mAggParam").innerHTML = a === "owa" ? `<label class="f">OWA α (risk): <span class="num" id="owaV">1.0</span><input type="range" id="owaA" min="0.1" max="10" step="0.1" value="1"></label><p class="small muted">α &lt; 1 — optimistik (OR ga yaqin), α = 1 — WLC, α &gt; 1 — pessimistik (AND ga yaqin). Q(r) = r^α.</p>` : a === "bool" ? `<label class="f">Har mezon μ ≥ <span class="num" id="boolV">0.5</span><input type="range" id="boolT" min="0.05" max="0.95" step="0.05" value="0.5"></label>` : ""; const o = $("#owaA"); if (o) o.addEventListener("input", e => $("#owaV").textContent = (+e.target.value).toFixed(1)); const b = $("#boolT"); if (b) b.addEventListener("input", e => $("#boolV").textContent = (+e.target.value).toFixed(2)); }
$("#mAgg").addEventListener("change", aggParam);

/* --- raster tör (EPSG:3857, haqiqiy katak ölçami ≈ berilgan km) --- */
let G = null;
function buildGrid(resKm) {
  const [x0, y1] = merc(55.95, 37.15), [x1, y0] = merc(73.2, 45.62), cs = resKm * 1000 / Math.cos(41.4 * Math.PI / 180);
  const W = Math.ceil((x1 - x0) / cs), H = Math.ceil((y0 - y1) / cs);
  const lat = new Float32Array(H), tcs = new Float32Array(H);
  for (let i = 0; i < H; i++) { lat[i] = imerc(0, y0 - (i + .5) * cs)[1]; tcs[i] = cs * Math.cos(lat[i] * Math.PI / 180) / 1000; }
  return { x0, y0, cs, W, H, n: W * H, lat, tcs, resKm };
}
function rasterize(fs, mode, G) { // mode: fill | stroke | point ; qaytaradi Uint8Array
  const c = document.createElement("canvas"); c.width = G.W; c.height = G.H; const g = c.getContext("2d", { willReadFrequently: true });
  const P = (lon, lat) => { const [x, y] = merc(lon, lat); return [(x - G.x0) / G.cs, (G.y0 - y) / G.cs]; };
  g.fillStyle = g.strokeStyle = "#000"; g.lineWidth = 1.2; g.lineJoin = "round";
  fs.forEach(f => {
    const geom = f.geometry; if (!geom) return;
    const ringPath = r => r.forEach((c2, i) => { const p = P(c2[0], c2[1]); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); });
    if (/Polygon/.test(geom.type) && mode === "fill") { g.beginPath(); (geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates).forEach(poly => poly.forEach(r => { ringPath(r); g.closePath(); })); g.fill("evenodd"); g.stroke(); }
    else if (/LineString/.test(geom.type)) { g.beginPath(); (geom.type === "LineString" ? [geom.coordinates] : geom.coordinates).forEach(ringPath); g.stroke(); }
    else if (/Polygon/.test(geom.type)) { g.beginPath(); (geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates).forEach(poly => poly.forEach(r => { ringPath(r); g.closePath(); })); g.stroke(); }
    else if (/Point/.test(geom.type)) { (geom.type === "Point" ? [geom.coordinates] : geom.coordinates).forEach(c2 => { const p = P(c2[0], c2[1]); g.fillRect(Math.floor(p[0]), Math.floor(p[1]), 1, 1); }); }
  });
  const d = g.getImageData(0, 0, G.W, G.H).data, out = new Uint8Array(G.n); for (let k = 0; k < G.n; k++) out[k] = d[k * 4 + 3] > 96 ? 1 : 0; return out;
}
function edt(mask, G) { // Felzenszwalb–Huttenlocher, aniq Evklid masofasi (kataklarda) → km
  const INF = 1e20, W = G.W, H = G.H, f = new Float64Array(Math.max(W, H)), d = new Float64Array(Math.max(W, H)), v = new Int32Array(Math.max(W, H)), z = new Float64Array(Math.max(W, H) + 1), tmp = new Float64Array(G.n);
  function dt1(n) { let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF; for (let q = 1; q < n; q++) { let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); } k++; v[k] = q; z[k] = s; z[k + 1] = INF; } k = 0; for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; } }
  for (let j = 0; j < W; j++) { for (let i = 0; i < H; i++) f[i] = mask[i * W + j] ? 0 : INF; dt1(H); for (let i = 0; i < H; i++) tmp[i * W + j] = d[i]; }
  const out = new Float32Array(G.n);
  for (let i = 0; i < H; i++) { for (let j = 0; j < W; j++) f[j] = tmp[i * W + j]; dt1(W); for (let j = 0; j < W; j++) out[i * W + j] = Math.sqrt(d[j]) * G.tcs[i]; }
  return out;
}
function zones(G) {
  const z = new Int16Array(G.n).fill(-1);
  D.viloyatlar.features.forEach((f, idx) => { const m = rasterize([f], "fill", G); for (let k = 0; k < G.n; k++) if (m[k] && z[k] < 0) z[k] = idx; });
  // Toşkent şahri kiçik: uning markaziy katagini majburan belgilaş
  return z;
}
function sampleUser(r, G, slope) {
  const out = new Float32Array(G.n);
  for (let i = 0; i < G.H; i++) { const lat = G.lat[i]; for (let j = 0; j < G.W; j++) { const lon = imerc(G.x0 + (j + .5) * G.cs, 0)[0]; out[i * G.W + j] = r.sample(lon, lat); } }
  if (!slope) return out;
  const s = new Float32Array(G.n).fill(NaN), at = (i, j) => out[Math.max(0, Math.min(G.H - 1, i)) * G.W + Math.max(0, Math.min(G.W - 1, j))];
  for (let i = 0; i < G.H; i++) for (let j = 0; j < G.W; j++) { const dx = (at(i, j + 1) - at(i, j - 1)) / (2 * G.tcs[i] * 1000), dy = (at(i + 1, j) - at(i - 1, j)) / (2 * G.tcs[i] * 1000); s[i * G.W + j] = Math.atan(Math.hypot(dx, dy)) * 180 / Math.PI; }
  return s;
}
const vf = (x, c) => { if (isNaN(x)) return NaN; const lo = Math.min(c.a, c.b), hi = Math.max(c.a, c.b); let t = hi === lo ? (x <= lo ? 0 : 1) : (x - lo) / (hi - lo); t = Math.max(0, Math.min(1, t)); return c.dir === "near" ? 1 - t : t; };
let RES = null; let sOverlay = null, rOverlay = null;
function owaCell(vals, w, alpha) { // Yager weighted OWA (Malczewski 2006)
  const n = vals.length, idx = [...vals.keys()].sort((a, b) => vals[b] - vals[a]); let acc = 0, prevQ = 0, s = 0;
  for (const k of idx) { acc += w[k]; const Q = Math.pow(Math.min(1, acc), alpha); s += (Q - prevQ) * vals[k]; prevQ = Q; } return s;
}
function aggregate(STD, w, ok, agg, par) {
  const n = STD[0].length, S = new Float32Array(n).fill(NaN), m = STD.length, vals = new Array(m);
  for (let k = 0; k < n; k++) { if (!ok[k]) continue; let bad = false; for (let q = 0; q < m; q++) { vals[q] = STD[q][k]; if (isNaN(vals[q])) bad = true; } if (bad) continue;
    if (agg === "wlc") { let s = 0; for (let q = 0; q < m; q++) s += w[q] * vals[q]; S[k] = s; }
    else if (agg === "owa") S[k] = owaCell(vals, w, par);
    else { let all = 1; for (let q = 0; q < m; q++) if (vals[q] < par) all = 0; S[k] = all; } }
  return S;
}
function topMask(S, ok, frac) { // aniq ulush: qiymat böyiça tartib, teng qiymatlarda indeks böyiça
  const idx = []; for (let k = 0; k < S.length; k++) if (ok[k] && !isNaN(S[k])) idx.push(k);
  idx.sort((a, b) => (S[b] - S[a]) || (a - b)); const n = Math.max(1, Math.floor(idx.length * frac)), m = new Uint8Array(S.length);
  for (let q = 0; q < n && q < idx.length; q++) m[idx[q]] = 1; return [m, S[idx[Math.min(n, idx.length) - 1]]];
}
function cellLayer(id, name, G, valFn, colorFn, tipFn, note) { // 3D ustunli raster
  const cells = []; for (let k = 0; k < G.n; k++) { const v = valFn(k); if (v == null) continue; const i = Math.floor(k / G.W), j = k % G.W; cells.push({ k, p: [imerc(G.x0 + (j + .5) * G.cs, 0)[0], G.lat[i]], v }); }
  const rad = G.resKm * 1000 / Math.SQRT2 * .96, H = 150000;
  const [lo0, la1] = imerc(G.x0, G.y0), [lo1, la0] = imerc(G.x0 + G.W * G.cs, G.y0 - G.H * G.cs);
  return addLayer(name, null, { kind: "raster", derived: true, note, bbox: [lo0, la0, lo1, la1], build: ctx => [new ColumnLayer({ id: id + uid, data: cells, getPosition: d => [d.p[0], d.p[1], pz(d.p[0], d.p[1])], diskResolution: 4, angle: 45, radius: rad, extruded: ctx.is3D, material: MAT, opacity: CITY ? .3 : 1, getElevation: d => baseH() + (d.v < 0 ? 400 * HZ() : (1500 + H * ctx.exag * d.v) * HZ()), getFillColor: d => colorFn(d), pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 110], tipFn: d => tipFn(d), parameters: { depthCompare: ctx.is3D ? "less-equal" : "always" }, updateTriggers: { getElevation: [ctx.exag] }, transitions: reduceMotion ? {} : { getElevation: { duration: 1200, enter: () => [SLAB] } } })] });
}
$("#mRun").addEventListener("click", runMcda);
async function runMcda() {
  const ac = active(); if (ac.length < 2) return toast("Kamida 2 ta mezon kerak");
  await busy(true, "Tör va masofa rasterlari…"); const t0 = performance.now();
  try {
    const res = +$("#mRes").value; if (!G || G.resKm !== res) { G = buildGrid(res); G.zone = zones(G); G.cache = {}; }
    const inUz = new Uint8Array(G.n); for (let k = 0; k < G.n; k++) inUz[k] = G.zone[k] >= 0 ? 1 : 0;
    const base = { yol: () => edt(rasterize(D.yollar.features, "stroke", G), G), shahar: () => edt(rasterize(D.shaharlar.features.filter(f => f.properties.aholi >= 100000), "point", G), G), daryo: () => edt(rasterize(D.daryolar.features, "stroke", G), G), kol: () => edt(rasterize(D.kollar.features, "fill", G), G), balandlik: () => sampleUser({ sample: demAt }, G, false), nishablik: () => sampleUser({ sample: demAt }, G, true) };
    const raw = ac.map(c => { const key = c.id; if (!G.cache[key]) G.cache[key] = base[key] ? base[key]() : sampleUser(c.raster, G, c.slope); return G.cache[key]; });
    const lakeM = G.cache.lakeM || (G.cache.lakeM = rasterize(D.kollar.features, "fill", G));
    const dR = G.cache.daryo || (G.cache.daryo = base.daryo());
    const ok = new Uint8Array(G.n); let nOk = 0, nCons = 0; const cL = $("#cLake").checked, cR = $("#cRiv").checked, rKm = +$("#cRivKm").value;
    for (let k = 0; k < G.n; k++) { if (!inUz[k]) continue; let c = 1; if (cL && lakeM[k]) c = 0; if (cR && dR[k] < rKm) c = 0; ok[k] = c; if (c) nOk++; else nCons++; }
    const STD = ac.map((c, q) => { const a = new Float32Array(G.n); for (let k = 0; k < G.n; k++) a[k] = inUz[k] ? vf(raw[q][k], c) : NaN; return a; });
    const w = weights(), agg = $("#mAgg").value, par = agg === "owa" ? +$("#owaA").value : agg === "bool" ? +$("#boolT").value : 0;
    const S = aggregate(STD, w, ok, agg, par);
    const [top, thr] = topMask(S, ok, .10);
    const ahp = $('input[name="wm"]:checked').value === "ahp" ? ahpCalc(ac.map(c => c.id)) : null;
    RES = { G, S, STD, raw, ok, inUz, top, thr, w, ac: ac.map(c => ({ ...c, raster: undefined })), agg, par, ahp, nOk, nCons, ms: performance.now() - t0, preset: MPRESET[M.preset].t, res, constraints: { lake: $("#cLake").checked, riv: $("#cRiv").checked ? +$("#cRivKm").value : null } };
    drawMcda(); zonal(); sites(); $("#mSens").disabled = false; $("#rTif").disabled = false; $("#rCsv").disabled = false;
    $("#mLog").textContent = `✓ ${G.W}×${G.H} katak (${fmt(G.n, 0)}), ${res} km\nruxsat: ${fmt(nOk, 0)} · çeklov: ${fmt(nCons, 0)}\n${fmt(RES.ms, 0)} ms`;
    commit("MCDA: " + RES.preset);
  } catch (e) { console.error(e); $("#mLog").textContent = "✕ " + e.message; }
  await busy(false);
}
function cellKm2(k) { const i = Math.floor(k / RES.G.W); return RES.G.tcs[i] * RES.G.tcs[i]; }
function drawMcda() {
  const { G, S, ok, inUz, top, agg } = RES;
  if (sOverlay) removeLayer(sOverlay.id);
  sOverlay = cellLayer("mcda", `Qulaylik S · ${RES.preset}`, G, k => !inUz[k] ? null : !ok[k] ? -1 : isNaN(S[k]) ? null : (agg === "bool" ? S[k] : S[k]),
    d => d.v < 0 ? [150, 45, 40, 230] : (top[d.k] && agg !== "bool") || (agg === "bool" && d.v) ? [255, 79, 139, 255] : [...ramp(d.v), 245],
    d => { const k = d.k, z = G.zone[k]; if (d.v < 0) return { title: "Çeklov", props: { viloyat: z >= 0 ? D.viloyatlar.features[z].properties.nomi : "—", sabab: "suv havzasi yoki daryo toşqin zonasi" } }; const o = { S: +S[k].toFixed(4), viloyat: z >= 0 ? D.viloyatlar.features[z].properties.nomi : "—", "eng qulay 10%": top[k] ? "ha" : "yöq" }; RES.ac.forEach((c, q) => { o[c.name + " (" + c.unit + ")"] = +RES.raw[q][k].toFixed(1); o["μ " + c.id] = +RES.STD[q][k].toFixed(3); }); return { title: "Katak #" + k, props: o }; },
    `${RES.res} km · ${agg.toUpperCase()}`);
  D.viloyatlar.features.forEach(f => delete f.properties._mcda);
  setLegend(`<h4>Qulaylik indeksi S</h4><div class="ramp" style="background:linear-gradient(90deg,${RAMP.join(",")})"></div><div class="lr"><span>0</span><span>0.5</span><span>1</span></div><div class="it"><i style="background:#FF4F8B"></i>eng yuqori 10% (S ≥ ${RES.thr.toFixed(3)})</div><div class="it"><i style="background:#962D28"></i>çeklov</div><p class="small muted" style="margin-top:6px">3D da ustun balandligi = S</p>`);
  if (!IS3D) set3D(true); fitBBox([55.9, 37.1, 73.2, 45.6]);
}
function zonal() {
  const { G, S, ok, top } = RES, Z = D.viloyatlar.features.map(f => ({ nomi: f.properties.nomi, n: 0, sum: 0, mx: -1, km: 0, okKm: 0, topKm: 0, hi: 0 }));
  const cls = [0, 0, 0, 0, 0];
  for (let k = 0; k < G.n; k++) { const z = G.zone[k]; if (z < 0) continue; const a = cellKm2(k), r = Z[z]; r.km += a; if (!ok[k] || isNaN(S[k])) continue; r.okKm += a; r.n++; r.sum += S[k]; r.mx = Math.max(r.mx, S[k]); if (top[k]) r.topKm += a; if (S[k] >= .8) r.hi += a; cls[Math.min(4, Math.floor(S[k] * 5))] += a; }
  Z.forEach(r => { r.mean = r.n ? r.sum / r.n : NaN; });
  D.viloyatlar.features.forEach((f, i) => f.properties._mcda = isNaN(Z[i].mean) ? 0 : Z[i].mean);
  RES.zonal = Z.slice().sort((a, b) => b.topKm - a.topKm); RES.cls = cls; if (EXT_METRIC === "mcda") redraw();
  const totTop = Z.reduce((s, r) => s + r.topKm, 0), mx = Math.max(...Z.map(r => r.topKm), 1);
  const html = `<div class="kpis"><div class="kpi"><b class="num">${fmt(RES.nOk, 0)}</b><span>tahlil kataklari</span></div><div class="kpi"><b class="num">${fmt(totTop, 0)}</b><span>eng qulay 10%, km²</span></div><div class="kpi"><b class="num">${RES.ahp ? RES.ahp.CR.toFixed(3) : "—"}</b><span>AHP CR</span></div><div class="kpi"><b class="num">${RES.w.map(x => x.toFixed(2)).join(" / ")}</b><span>vaznlar</span></div></div>
  <table class="t"><tr><th>Viloyat</th><th class="r">Örtaça S</th><th class="r">Maks S</th><th class="r">Eng qulay 10%, km²</th><th class="r">Uluş (ruxsat etilgan)</th><th class="r">S ≥ 0.8, km²</th><th></th></tr>${Z.map(r => `<tr><td>${esc(r.nomi)}</td><td class="r num">${isNaN(r.mean) ? "—" : r.mean.toFixed(3)}</td><td class="r num">${r.mx < 0 ? "—" : r.mx.toFixed(3)}</td><td class="r num">${fmt(r.topKm, 0)}</td><td class="r num">${r.okKm ? fmt(r.topKm / r.okKm * 100, 1) + "%" : "—"}</td><td class="r num">${fmt(r.hi, 0)}</td><td style="width:18%"><div class="bar"><i style="width:${r.topKm / mx * 100}%"></i></div></td></tr>`).join("")}</table>
  <p class="small muted">Zonal statistika: katak markazi viloyat içida bölsa, katak şu viloyatga tegişli. Katak maydoni haqiqiy (φ böyiça cos tuzatişi bilan). Kiçik birliklar (Toşkent şahri, 243 km²) ${RES.res} km katakda kam kataklar bilan ifodalanadi.</p>`;
  setDrawer(`MCDA natijalari · ${RES.preset}`, `${RES.res} km · ${RES.agg.toUpperCase()}`, html, ["mcda_zonal.csv", zonalCsv()]);
}
function zonalCsv() { return toCsv(["viloyat", "ortacha_S", "maks_S", "eng_qulay_10%_km2", "ruxsat_km2", "S>=0.8_km2"], RES.zonal.map(r => [r.nomi, isNaN(r.mean) ? "" : r.mean.toFixed(4), r.mx < 0 ? "" : r.mx.toFixed(4), r.topKm.toFixed(1), r.okKm.toFixed(1), r.hi.toFixed(1)])); }
function sites() {
  const { G, S, ok } = RES, idx = []; for (let k = 0; k < G.n; k++) if (ok[k] && !isNaN(S[k])) idx.push(k); idx.sort((a, b) => S[b] - S[a]);
  const pick = [], minKm = 60;
  for (const k of idx) { const i = Math.floor(k / G.W), j = k % G.W, [lon] = imerc(G.x0 + (j + .5) * G.cs, 0), lat = G.lat[i];
    if (pick.every(p => turf.distance([p.lon, p.lat], [lon, lat]) >= minKm)) pick.push({ k, lon, lat, S: S[k] }); if (pick.length >= 10) break; }
  const fs = pick.map((p, r) => { const z = G.zone[p.k]; return turf.point([+p.lon.toFixed(4), +p.lat.toFixed(4)], { orin: r + 1, S: +p.S.toFixed(4), viloyat: z >= 0 ? D.viloyatlar.features[z].properties.nomi : "—", ...Object.fromEntries(RES.ac.map((c, q) => [c.id + (c.unit === "km" ? "_km" : ""), +RES.raw[q][p.k].toFixed(1)])) }); });
  const old = LAYERS.find(l => l.name.startsWith("Eng yaxşi 10 joy")); if (old) removeLayer(old.id);
  RES.sites = fs;
  const sid = "sites" + uid;
  addLayer(`Eng yaxşi 10 joy (≥ ${minKm} km oraliq)`, fcOf(fs), { derived: true, style: { stroke: "#fff", fill: "#FFFFFF" }, build: ctx => [
    new ColumnLayer({ id: sid, data: fs, getPosition: f => [f.geometry.coordinates[0], f.geometry.coordinates[1], pz(f.geometry.coordinates[0], f.geometry.coordinates[1])], diskResolution: 16, radius: 4500, extruded: ctx.is3D, material: MAT, getElevation: f => baseH() + (1500 + 150000 * ctx.exag * f.properties.S + 70000) * HZ(), getFillColor: [255, 255, 255, 255], pickable: true, autoHighlight: true, tipFn: f => ({ title: "Örin " + f.properties.orin, props: f.properties }), parameters: { depthCompare: ctx.is3D ? "less-equal" : "always" }, updateTriggers: { getElevation: [ctx.exag] } }),
    new TextLayer({ id: sid + "t", data: fs, getPosition: f => [f.geometry.coordinates[0], f.geometry.coordinates[1], ctx.is3D ? pz(f.geometry.coordinates[0], f.geometry.coordinates[1]) + baseH() + (1500 + 150000 * ctx.exag * f.properties.S + 80000) * HZ() : 0], getText: f => String(f.properties.orin), getSize: 15, fontWeight: 700, fontFamily: "IBM Plex Mono, monospace", characterSet: "auto", getColor: [255, 255, 255, 255], fontSettings: { sdf: true }, outlineWidth: 4, outlineColor: [255, 79, 139, 255], getPixelOffset: [0, -10], parameters: { depthCompare: "always" }, updateTriggers: { getPosition: [ctx.exag, ctx.is3D] } })] });
}
/* --- sezgirlik --- */
function gammaS(k) { if (k < 1) return gammaS(k + 1) * Math.pow(Math.random(), 1 / k); const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d); for (;;) { let x, v; do { const u1 = Math.random(), u2 = Math.random(); x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); v = 1 + c * x; } while (v <= 0); v = v * v * v; const u = Math.random(); if (u < 1 - .0331 * x ** 4 || Math.log(u) < .5 * x * x + d * (1 - v + Math.log(v))) return d * v; } }
function quickTop(S, ok, frac) { // gistogramma orqali 10% çegara
  const B = 2048, h = new Uint32Array(B); let n = 0; for (let k = 0; k < S.length; k++) if (ok[k] && !isNaN(S[k])) { h[Math.min(B - 1, Math.floor(S[k] * B))]++; n++; }
  let need = Math.floor(n * frac), b = B - 1; for (; b >= 0; b--) { need -= h[b]; if (need <= 0) break; } return b / B;
}
$("#mSens").addEventListener("click", async () => {
  if (!RES) return; if (RES.agg === "bool") return toast("Sezgirlik WLC/OWA uçun");
  await busy(true, "Sezgirlik: OAT…");
  const { STD, ok, top, w, agg, par, G } = RES, m = w.length;
  const jac = (a, b) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { if (a[k] && b[k]) i++; if (a[k] || b[k]) u++; } return u ? i / u : 1; };
  const steps = [-.2, -.1, .1, .2], oat = [];
  for (let q = 0; q < m; q++) { const row = []; for (const s of steps) { const w2 = w.slice(); const nw = Math.max(0, Math.min(1, w[q] * (1 + s))); const rest = 1 - w[q]; for (let j = 0; j < m; j++) w2[j] = j === q ? nw : (rest > 0 ? w[j] * (1 - nw) / rest : (1 - nw) / (m - 1)); const S2 = aggregate(STD, w2, ok, agg, par); const [t2] = topMask(S2, ok, .10); let dS = 0, c = 0; for (let k = 0; k < S2.length; k++) if (!isNaN(S2[k])) { dS += Math.abs(S2[k] - RES.S[k]); c++; } row.push({ s, J: jac(top, t2), dS: dS / c }); } oat.push(row); }
  await busy(true, "Sezgirlik: Monte-Karlo…");
  const N = Math.max(50, Math.min(2000, +$("#mcN").value)), K = +$("#mcK").value, freq = new Uint16Array(G.n), ws = [];
  for (let r = 0; r < N; r++) { const g = w.map(x => gammaS(Math.max(.05, K * x))), s = g.reduce((a, b) => a + b, 0), w2 = g.map(x => x / s); ws.push(w2); const S2 = aggregate(STD, w2, ok, agg, par), [t2m] = topMask(S2, ok, .10); for (let k = 0; k < G.n; k++) if (t2m[k]) freq[k]++; if (r % 25 === 0) await sleep(0); }
  let nTop = 0, stable = 0; for (let k = 0; k < G.n; k++) if (top[k]) { nTop++; if (freq[k] / N >= .8) stable++; }
  const wsd = w.map((_, q) => { const xs = ws.map(v => v[q]), mu = xs.reduce((a, b) => a + b, 0) / N; return Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / N); });
  RES.sens = { oat, steps, N, K, stable: stable / nTop, wsd };
  const old = LAYERS.find(l => l.name.startsWith("Barqarorlik")); if (old) removeLayer(old.id); if (sOverlay) { sOverlay.visible = false; renderLayers(); }
  cellLayer("mc", `Barqarorlik: top-10% çastotasi (N=${N})`, G, k => !RES.inUz[k] || !ok[k] ? null : freq[k] / N, d => d.v === 0 ? [60, 80, 100, 90] : [...ramp(d.v), 245], d => ({ title: "Barqarorlik", props: { "top-10% ga tuşiş": (d.v * 100).toFixed(1) + "%", "bazaviy top-10%": top[d.k] ? "ha" : "yöq" } }), `Monte-Karlo, κ=${K}`);
  setLegend(`<h4>Top-10% ga tuşiş çastotasi</h4><div class="ramp" style="background:linear-gradient(90deg,${RAMP.join(",")})"></div><div class="lr"><span>0</span><span>50%</span><span>100%</span></div><p class="small muted">${N} ta tasodifiy vazn tömi (Dirixle, κ=${K})</p>`);
  const html = `<div class="kpis"><div class="kpi"><b class="num">${(stable / nTop * 100).toFixed(1)}%</b><span>bazaviy top-10% kataklarning ≥80% holatda saqlanişi</span></div><div class="kpi"><b class="num">${N}</b><span>Monte-Karlo takrori</span></div><div class="kpi"><b class="num">${wsd.map(x => x.toFixed(3)).join(" / ")}</b><span>vaznlar standart oğişi</span></div></div>
  <table class="t"><tr><th>Mezon (OAT, Chen va b., 2010)</th><th class="r">w</th>${steps.map(s => `<th class="r">${s > 0 ? "+" : ""}${s * 100}% · Jaccard</th>`).join("")}<th class="r">ΔS örtaça (±20%)</th></tr>${RES.ac.map((c, q) => `<tr><td>${esc(c.name)}</td><td class="r num">${w[q].toFixed(3)}</td>${oat[q].map(o => `<td class="r num" style="color:${o.J < .7 ? "var(--bad)" : o.J < .85 ? "var(--warn)" : "var(--good)"}">${o.J.toFixed(3)}</td>`).join("")}<td class="r num">${((oat[q][0].dS + oat[q][3].dS) / 2).toFixed(4)}</td></tr>`).join("")}</table>
  <p class="small muted">Jaccard = |T₀ ∩ T₁| / |T₀ ∪ T₁| — bazaviy va özgartirilgan vaznlardagi eng qulay 10% hudud ustma-ustligi. 1 — özgariş yöq; &lt; 0.7 — natija şu mezon vazniga sezgir.</p>`;
  setDrawer("Sezgirlik tahlili", `OAT ±10/20% · Monte-Karlo N=${N}`, html, ["sezgirlik_oat.csv", toCsv(["mezon", "w", ...steps.map(s => "J" + s * 100)], RES.ac.map((c, q) => [c.name, w[q].toFixed(4), ...oat[q].map(o => o.J.toFixed(4))]))]);
  commit("Sezgirlik tahlili"); await busy(false);
});

/* =========================================================
   EKSPORT: GeoTIFF (Float32, EPSG:3857) + ZIP
   ========================================================= */
function geotiff(S, G) {
  const W = G.W, H = G.H, dataBytes = W * H * 4;
  const tags = []; // [tag, type, count, value(s)]
  const T = (tag, type, vals) => tags.push({ tag, type, vals });
  T(256, 4, [W]); T(257, 4, [H]); T(258, 3, [32]); T(259, 3, [1]); T(262, 3, [1]); T(273, 4, [0]); T(277, 3, [1]); T(278, 4, [H]); T(279, 4, [dataBytes]); T(284, 3, [1]); T(339, 3, [3]);
  T(33550, 12, [G.cs, G.cs, 0]); T(33922, 12, [0, 0, 0, G.x0, G.y0, 0]);
  T(34735, 3, [1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 3857]);
  T(42113, 2, [..."-9999\0"].map(c => c.charCodeAt(0)));
  tags.sort((a, b) => a.tag - b.tag);
  const sz = { 2: 1, 3: 2, 4: 4, 12: 8 }, ifdOff = 8, ifdSize = 2 + tags.length * 12 + 4; let extra = ifdOff + ifdSize;
  tags.forEach(t => { const n = t.vals.length * sz[t.type]; t.count = t.vals.length; if (n > 4) { t.off = extra; extra += n + (n % 2); } });
  const dataOff = extra; tags.find(t => t.tag === 273).vals = [dataOff];
  const buf = new ArrayBuffer(dataOff + dataBytes), dv = new DataView(buf);
  dv.setUint16(0, 0x4949); dv.setUint16(2, 42, true); dv.setUint32(4, ifdOff, true); dv.setUint16(ifdOff, tags.length, true);
  const wr = (o, type, v) => { if (type === 2) dv.setUint8(o, v); else if (type === 3) dv.setUint16(o, v, true); else if (type === 4) dv.setUint32(o, v, true); else dv.setFloat64(o, v, true); };
  tags.forEach((t, i) => { const p = ifdOff + 2 + i * 12; dv.setUint16(p, t.tag, true); dv.setUint16(p + 2, t.type, true); dv.setUint32(p + 4, t.count, true); if (t.off != null) { dv.setUint32(p + 8, t.off, true); t.vals.forEach((v, j) => wr(t.off + j * sz[t.type], t.type, v)); } else t.vals.forEach((v, j) => wr(p + 8 + j * sz[t.type], t.type, v)); });
  dv.setUint32(ifdOff + 2 + tags.length * 12, 0, true);
  for (let k = 0; k < W * H; k++) dv.setFloat32(dataOff + k * 4, isNaN(S[k]) ? -9999 : S[k], true);
  return new Uint8Array(buf);
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = u => { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(files) { // [{name, data:Uint8Array}] — STORE
  const enc = new TextEncoder(), parts = [], cen = []; let off = 0;
  files.forEach(f => { const nm = enc.encode(f.name), c = crc32(f.data), h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true); h.setUint32(14, c, true); h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, nm.length, true); parts.push(new Uint8Array(h.buffer), nm, f.data);
    const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint32(16, c, true); ch.setUint32(20, f.data.length, true); ch.setUint32(24, f.data.length, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true); cen.push(new Uint8Array(ch.buffer), nm); off += 30 + nm.length + f.data.length; });
  const cs = cen.reduce((s, a) => s + a.length, 0), e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...cen, new Uint8Array(e.buffer)]);
}
$("#rTif").addEventListener("click", () => { if (!RES) return; const enc = new TextEncoder(); download("qulaylik_S_3857.zip", zip([{ name: "qulaylik_S_3857.tif", data: geotiff(RES.S, RES.G) }, { name: "README.txt", data: enc.encode(`Qulaylik indeksi S (0..1), Float32, NoData=-9999\nCRS: EPSG:3857, katak ${RES.G.cs.toFixed(1)} m (haqiqiy ≈ ${RES.res} km)\nStsenariy: ${RES.preset}; agregatsiya: ${RES.agg}; vaznlar: ${RES.w.map(x => x.toFixed(4)).join(", ")}\nManba: Natural Earth 1:10M; OverlayLab GIS\n`) }])); });
$("#rCsv").addEventListener("click", () => RES && download("mcda_zonal.csv", zonalCsv()));

/* =========================================================
   HISOBOT
   ========================================================= */
let REPORT_MD = "";
function buildReport() {
  const box = $("#report"); const md = [], h = [];
  const P = (t) => { h.push(`<p>${t}</p>`); md.push(t.replace(/<[^>]+>/g, "") + "\n"); }, H = t => { h.push(`<h4>${t}</h4>`); md.push(`## ${t}\n`); };
  const TB = (head, rows) => { h.push(`<div style="overflow:auto"><table class="t"><tr>${head.map(x => `<th>${esc(x)}</th>`).join("")}</tr>${rows.map(r => `<tr>${r.map(x => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</table></div>`); md.push(`| ${head.join(" | ")} |\n|${head.map(() => "---").join("|")}|\n${rows.map(r => `| ${r.join(" | ")} |`).join("\n")}\n`); };
  md.push(`# Fazoviy ma’lumotlarni ustma-ust tahlil qiliş: Özbekiston misolida\n\n_Avtomatik hisobot · OverlayLab GIS · ${new Date().toLocaleString("uz-UZ")}_\n`);
  H("1. Ma’lumotlar");
  P(`Tayanç qatlamlar: Natural Earth 1:10 000 000 (jamoat mulki, v5.x) — ${D.viloyatlar.features.length} ta ma’muriy birlik, ${D.daryolar.features.length} ta daryo obyekti, ${D.kollar.features.length} ta suv havzasi, ${D.shaharlar.features.length} ta aholi punkti, ${D.yollar.features.length} ta yöl bölagi. Relyef: ETOPO1 (NOAA) 10′ (~18 km) global modeli, dengiz sathiga nisbatan metrda; nişablik şu modeldan MCDA töri ölçamida hisoblanadi. Koordinatalar WGS 84 (EPSG:4326). Maydon va perimetr Lambert teng maydonli azimutal proyeksiyasida (LAEA, φ₀ = 41.5°, λ₀ = 64°) hisoblangan; sferik hisob (turf.area) bilan solişirma beriladi.${USER_RASTERS.length ? ` Foydalanuvçi rasterlari: ${USER_RASTERS.map(r => `${r.name} (${r.w}×${r.h}, ${r.code})`).join(", ")}.` : ""}`);
  if (RUNS.length) { H("2. Vektor overlay tahlillari"); P("Overlay amallari poligonlarni aniq kesiş algoritmi (polyclip-ts, Turf.js 7.1) bilan bajarilgan. Har bir natija poligonida maydon, perimetr va Polsby-Popper ixçamlik indeksi (4πA/P²) hisoblangan; PP va maydon çegarasidan past poligonlar sliver sifatida belgilangan.");
    TB(["Tahlil", "Amal", "Obyekt", "Maydon, km²", "Sliver", "Vaqt, ms"], RUNS.map(r => [r.name, OP_NAME[r.op] || r.op, r.n, fmt(r.area, 0), r.slivers, fmt(r.ms, 0)]));
    RUNS.slice(-3).forEach(r => { if (r.rows.length) { P(`<b>${esc(r.name)}</b>`); TB(r.head, r.rows.map(x => x.map(v => typeof v === "number" ? fmt(v, 1) : v))); } }); }
  if (RES) {
    const n = RES.ac.length;
    H(`${RUNS.length ? 3 : 2}. Köp mezonli qulaylik tahlili: ${RES.preset}`);
    P(`Usul: GIS asosidagi köp mezonli qaror tahlili (MCDA; Malczewski, 1999, 2006). Hudud ${RES.res} km li katakli raster (EPSG:3857 tör, haqiqiy katak ölçami φ böyiça cos tuzatişi bilan) ga keltirildi: ${RES.G.W}×${RES.G.H} = ${fmt(RES.G.n, 0)} katak, şundan Özbekiston içida ${fmt(RES.nOk + RES.nCons, 0)}. Masofa rasterlari aniq Evklid masofa almaştirişi (Felzenszwalb–Huttenlocher) bilan hisoblandi.`);
    TB(["Mezon", "Yönaliş", "a", "b", "Vazn"], RES.ac.map((c, i) => [c.name, c.dir === "near" ? "kam — yaxşi" : "köp — yaxşi", c.a + " " + c.unit, c.b + " " + c.unit, RES.w[i].toFixed(3)]));
    P(`Standartlaş: çiziqli qiymat funksiyasi μ ∈ [0, 1]. Vaznlar: ${RES.ahp ? `AHP (Saaty, 1980), geometrik örtaça usuli; λmax = ${RES.ahp.lmax.toFixed(3)}, CI = ${RES.ahp.CI.toFixed(4)}, RI = ${RI[n].toFixed(2)}, CR = ${RES.ahp.CR.toFixed(3)} (${RES.ahp.CR < .1 ? "izçil" : "izçil emas"})` : "qölda berilgan va normallangan"}. Agregatsiya: ${RES.agg === "wlc" ? "vaznli çiziqli kombinatsiya, S = Σ wᵢ μᵢ" : RES.agg === "owa" ? `vaznli OWA (Yager, 1988; Malczewski, 2006), Q(r) = r^α, α = ${RES.par}` : `Boolean AND, μᵢ ≥ ${RES.par}`}. Çeklovlar: ${[RES.constraints.lake ? "suv havzalari içi" : "", RES.constraints.riv != null ? `daryodan ${RES.constraints.riv} km gaça` : ""].filter(Boolean).join("; ") || "yöq"}.`);
    const clsN = ["0.0–0.2 juda past", "0.2–0.4 past", "0.4–0.6 örta", "0.6–0.8 yuqori", "0.8–1.0 juda yuqori"];
    TB(["Qulaylik sinfi", "Maydon, km²", "Uluş"], RES.cls.map((v, i) => [clsN[i], fmt(v, 0), fmt(v / RES.cls.reduce((a, b) => a + b, 0) * 100, 1) + "%"]).reverse());
    P(`Viloyatlar kesimida zonal statistika (eng qulay 10% hudud böyiça tartiblangan):`);
    TB(["Viloyat", "Örtaça S", "Eng qulay 10%, km²", "S ≥ 0.8, km²"], RES.zonal.map(r => [r.nomi, isNaN(r.mean) ? "—" : r.mean.toFixed(3), fmt(r.topKm, 0), fmt(r.hi, 0)]));
    if (RES.sites) TB(["Örin", "φ, λ", "S", "Viloyat"], RES.sites.map(f => [f.properties.orin, `${f.geometry.coordinates[1]}, ${f.geometry.coordinates[0]}`, f.properties.S.toFixed(3), f.properties.viloyat]));
    if (RES.sens) { const s = RES.sens; P(`Sezgirlik tahlili. OAT (Chen va b., 2010): har bir vazn ±10% va ±20% özgartirilib, qolganlari mutanosib normallandi; eng qulay 10% hudud bazaviy holat bilan Jaccard indeksi orqali solişirildi. Monte-Karlo: ${s.N} ta vazn tömi Dirixle taqsimotidan (κ = ${s.K}) olindi. Bazaviy eng qulay kataklarning ${(s.stable * 100).toFixed(1)}% i takrorlarning kamida 80% ida eng qulay 10% da qoldi.`);
      TB(["Mezon", ...s.steps.map(x => (x > 0 ? "+" : "") + x * 100 + "%")], RES.ac.map((c, q) => [c.name, ...s.oat[q].map(o => o.J.toFixed(3))])); }
  }
  H("Çeklovlar va noaniqliklar");
  P("1:10M masştabdagi ma’lumotlar milliy darajadagi skrining uçun mos: çegaralar umumlaştirilgan, daryo tarmoği faqat yirik daryolarni (Amudaryo, Sirdaryo, Zarafşon, Norin, Panj) öz içiga oladi, kiçik daryo va kanallar yöq. Içki relyef modeli ETOPO1 10′ (~18 km) aniqlikda: tog‘li hududlarda çöqqilar silliqlanadi (maks. ~3 500 m, haqiqiy çöqqilar 4 600 m gaça), nişablik qiymatlari past çiqadi. Batafsil tahlil uçun SRTM (30–90 m) GeoTIFF yuklang. Masofalar EPSG:3857 töridagi katak masofasining kenglik böyiça cos tuzatişi bilan hisoblanadi (nisbiy xato bir neça foiz). Natija qaror qabul qilişni qöllab-quvvatlovçi skrining bölib, joyida tekşiruvni almaştirmaydi.");
  H("Adabiyotlar");
  const refs = ["McHarg, I.L. (1969). Design with Nature. Garden City, NY: Natural History Press.", "Saaty, T.L. (1980). The Analytic Hierarchy Process. New York: McGraw-Hill.", "Yager, R.R. (1988). On ordered weighted averaging aggregation operators in multicriteria decisionmaking. IEEE Transactions on Systems, Man, and Cybernetics, 18(1), 183–190.", "Tomlin, C.D. (1990). Geographic Information Systems and Cartographic Modeling. Englewood Cliffs, NJ: Prentice Hall.", "Malczewski, J. (1999). GIS and Multicriteria Decision Analysis. New York: Wiley.", "Malczewski, J. (2006). GIS-based multicriteria decision analysis: a survey of the literature. International Journal of Geographical Information Science, 20(7), 703–726.", "Felzenszwalb, P.F., Huttenlocher, D.P. (2012). Distance transforms of sampled functions. Theory of Computing, 8, 415–428.", "Chen, Y., Yu, J., Khan, S. (2010). Spatial sensitivity analysis of multi-criteria weights in GIS-based land suitability evaluation. Environmental Modelling & Software, 25(12), 1582–1591.", "Natural Earth. 1:10m Cultural and Physical Vectors (public domain). naturalearthdata.com.", "Amante, C., Eakins, B.W. (2009). ETOPO1 1 Arc-Minute Global Relief Model: Procedures, Data Sources and Analysis. NOAA Technical Memorandum NESDIS NGDC-24.", "Fatiando a Terra Project (2022). Earth topography grid at 10 arc-minute resolution (v1). Zenodo. doi:10.5281/zenodo.5882203 (CC-BY 4.0).", "Runfola, D. va b. (2020). geoBoundaries: A global database of political administrative boundaries. PLoS ONE, 15(4), e0231866. (UZB ADM2: OCHA ROCCA, CC BY 3.0 IGO)."];
  h.push(`<ol class="small">${refs.map(r => `<li>${esc(r)}</li>`).join("")}</ol>`); md.push(refs.map((r, i) => `${i + 1}. ${r}`).join("\n") + "\n");
  box.innerHTML = h.join(""); REPORT_MD = md.join("\n");
}
$("#rBuild").addEventListener("click", buildReport);
$("#rPng").addEventListener("click", () => { deckgl.redraw(true); const c = deckgl.getCanvas ? deckgl.getCanvas() : $("#map canvas"); try { c.toBlob(b => b ? download("overlaylab_xarita.png", b) : toast("Rasm olinmadi"), "image/png"); } catch (e) { toast("Rasm olinmadi"); } });
$("#rMd").addEventListener("click", () => { buildReport(); download("overlay_hisobot.md", REPORT_MD); });

/* ---------- start ---------- */
loadPreset("logi"); aggParam(); fillSelects();

/* =========================================================
   TARIX: Orqaga / Oldinga (undo / redo)
   ========================================================= */
const HIST = [], FUT = []; let RESTORING = false, commitT = null;
const UI_IDS = ["mPreset", "mRes", "mAgg", "owaA", "boolT", "cLake", "cRiv", "cRivKm", "mcN", "mcK", "vOp", "vParam", "vFilt", "vField", "vDiss", "extMetric", "lblToggle", "exag", "ppThr", "slThr"];
function readUI() { const o = {}; UI_IDS.forEach(id => { const el = document.getElementById(id); if (el) o[id] = el.type === "checkbox" ? el.checked : el.value; }); o.wm = $('input[name="wm"]:checked').value; o.vA = $("#vA").value; o.vB = $("#vB").value; o.tab = ($('.tabs button[aria-selected="true"]') || {}).dataset?.p; return o; }
function writeUI(o) { UI_IDS.forEach(id => { const el = document.getElementById(id); if (el && o[id] !== undefined) { if (el.type === "checkbox") el.checked = o[id]; else el.value = o[id]; } }); const r = $(`input[name="wm"][value="${o.wm}"]`); if (r) r.checked = true; }
function snap(label) {
  return { label, t: Date.now(),
    layers: LAYERS.map(l => ({ l, vis: l.visible })),
    M: { preset: M.preset, crit: M.crit.map(c => ({ ...c })), ahp: { ...M.ahp }, man: { ...M.man } },
    ui: readUI(), RES, sOverlay, G, IS3D, EXAG, EXT_METRIC, LABELS, CITY, SLAB,
    view: { longitude: VS.longitude, latitude: VS.latitude, zoom: VS.zoom, pitch: VS.pitch, bearing: VS.bearing },
    drawer: DRAWER ? { ...DRAWER } : null, drawerHidden: $("#drawer").classList.contains("empty"),
    legend: $("#legend").innerHTML, legendOn: $("#legend").classList.contains("on"),
    mcdaVil: D.viloyatlar.features.map(f => f.properties._mcda), runs: RUNS.length,
    logs: { v: $("#vLog").textContent, m: $("#mLog").textContent } };
}
function commit(label, debounce) {
  if (RESTORING) return;
  const go = () => { HIST.push(snap(label)); if (HIST.length > 80) HIST.shift(); FUT.length = 0; updHistUI(); };
  clearTimeout(commitT); if (debounce) commitT = setTimeout(go, 450); else go();
}
function restore(s) {
  RESTORING = true;
  LAYERS.length = 0; s.layers.forEach(({ l, vis }) => { l.visible = vis; LAYERS.push(l); });
  M.preset = s.M.preset; M.crit = s.M.crit.map(c => ({ ...c })); M.ahp = { ...s.M.ahp }; M.man = { ...s.M.man };
  writeUI(s.ui); aggParam(); writeUI(s.ui); if ($("#owaV") && $("#owaA")) $("#owaV").textContent = (+$("#owaA").value).toFixed(1); if ($("#boolV") && $("#boolT")) $("#boolV").textContent = (+$("#boolT").value).toFixed(2);
  RES = s.RES; sOverlay = s.sOverlay; G = s.G; EXAG = s.EXAG; EXT_METRIC = s.EXT_METRIC; LABELS = s.LABELS; CITY = s.CITY; SLAB = s.SLAB; RUNS.length = Math.min(RUNS.length, s.runs);
  $("#exagV").textContent = "×" + EXAG.toFixed(1); $("#citySel").value = CITY && !CITY.startsWith("vil:") ? CITY : ""; $("#vilSel").value = CITY && CITY.startsWith("vil:") ? CITY.slice(4) : "";
  IS3D = s.IS3D; $("#v3d").setAttribute("aria-pressed", IS3D); $("#v2d").setAttribute("aria-pressed", !IS3D);
  D.viloyatlar.features.forEach((f, i) => { if (s.mcdaVil[i] == null) delete f.properties._mcda; else f.properties._mcda = s.mcdaVil[i]; });
  renderLayers(); fillSelects(); if (s.ui.vA) $("#vA").value = s.ui.vA; if (s.ui.vB) $("#vB").value = s.ui.vB; updHelp(); renderCrit(); renderW();
  $("#mSens").disabled = !RES; $("#rTif").disabled = !RES; $("#rCsv").disabled = !RES;
  $("#vLog").textContent = s.logs.v; $("#mLog").textContent = s.logs.m;
  if (s.drawer && !s.drawerHidden) { setDrawer(s.drawer.title, s.drawer.sub, s.drawer.html, s.drawer.csv, s.drawer.bind); if (s.drawer.bind) s.drawer.bind(); } else { $("#drawer").classList.add("empty"); DRAWER = s.drawer; }
  $("#legend").innerHTML = s.legend; $("#legend").classList.toggle("on", s.legendOn);
  redraw(); setView(s.view, reduceMotion ? 0 : 900);
  RESTORING = false; updHistUI();
}
function undo() { if (HIST.length < 2) return toast("Orqaga qaytadigan qadam yöq"); const cur = HIST.pop(); FUT.push(cur); restore(HIST[HIST.length - 1]); toast("↶ Bekor qilindi: " + cur.label); }
function redo() { if (!FUT.length) return toast("Oldinga qadam yöq"); const s = FUT.pop(); HIST.push(s); restore(s); toast("↷ Qaytarildi: " + s.label); }
function updHistUI() {
  const u = $("#undoBtn"), r = $("#redoBtn"); if (!u) return;
  u.disabled = HIST.length < 2; r.disabled = !FUT.length;
  u.title = HIST.length >= 2 ? "Orqaga: " + HIST[HIST.length - 1].label + " (Ctrl+Z)" : "Orqaga (Ctrl+Z)";
  r.title = FUT.length ? "Oldinga: " + FUT[FUT.length - 1].label + " (Ctrl+Y)" : "Oldinga (Ctrl+Y)";
  $("#histList").innerHTML = HIST.map((h, i) => `<button type="button" class="hitem${i === HIST.length - 1 ? " cur" : ""}" data-h="${i}"><span class="num">${String(i + 1).padStart(2, "0")}</span>${esc(h.label)}</button>`).reverse().join("") + FUT.slice().reverse().map(h => `<button type="button" class="hitem fut" disabled><span class="num">↷</span>${esc(h.label)}</button>`).join("");
}
$("#undoBtn").addEventListener("click", undo); $("#redoBtn").addEventListener("click", redo);
$("#histBtn").addEventListener("click", e => { e.stopPropagation(); $("#histPop").classList.toggle("on"); });
document.addEventListener("click", e => { if (!e.target.closest("#histPop")) $("#histPop").classList.remove("on"); });
$("#histList").addEventListener("click", e => { const b = e.target.closest("[data-h]"); if (!b) return; const i = +b.dataset.h; while (HIST.length - 1 > i) FUT.push(HIST.pop()); restore(HIST[i]); toast("Holat: " + HIST[i].label); });
document.addEventListener("keydown", e => {
  if (e.target.matches("input[type=text],input[type=number],textarea")) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
  else if ((e.ctrlKey || e.metaKey) && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
});
// parametr özgarişlari (birlaştirib) tarixga yoziladi
["#p-mcda", "#p-vec"].forEach(id => $(id).addEventListener("change", e => { if (e.target.closest("#histPop")) return; commit((id === "#p-mcda" ? "MCDA parametri: " : "Overlay parametri: ") + paramName(e.target), true); }));
function paramName(el) { const lab = el.closest("label"); let t = lab ? [...lab.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(" ").replace(/\s+/g, " ").trim() : ""; if (!t && el.dataset.p) t = "AHP " + el.dataset.p.replace(",", " / "); if (!t && el.dataset.k) t = "mezon " + el.dataset.k; const v = el.type === "checkbox" ? (el.checked ? "ha" : "yöq") : el.tagName === "SELECT" ? el.selectedOptions[0].text : el.value; return (t || el.id || "qiymat").slice(0, 30) + " → " + String(v).slice(0, 24); }
$("#exag").addEventListener("change", () => commit("Balandlik masştabi ×" + EXAG.toFixed(1), true));
$("#extMetric").addEventListener("change", () => commit("Viloyat balandligi: " + $("#extMetric").selectedOptions[0].text, true));
$("#lblToggle").addEventListener("change", () => commit(LABELS ? "Nomlar yoqildi" : "Nomlar yaşirildi"));

commit("Boşlanğiç holat");


/* =====================================================================
   MA'LUMOTLAR BAZASI — jonli statistik körsatkiçlar (claude db)
   hududlar/{iso}      : { nomi, aholi, sana, manba, k:{...} }
   shaharlar/{id}      : { nomi, aholi, sana }
   sozlamalar/korsatkichlar : { list:[{k, nomi, birlik}] }
   jurnal/{auto}       : { t, kim, obj, k, eski, yangi }
   ===================================================================== */
const BAZA = { db: null, user: null, uid: null, canWrite: null, live: false, ts: null, defs: [], hud: {}, sha: {}, log: [], k: "aholi", note: "" };
function bazaTip(p) { const o = {}; BAZA.defs.forEach(d => { const v = p["k_" + d.k]; if (v != null && v !== "") o[d.nomi.toLowerCase() + (d.birlik ? ", " + d.birlik : "")] = fmt(v, Number.isInteger(+v) ? 0 : 1); }); return o; }
const did = s => s.toLowerCase().replace(/ş/g, "sh").replace(/ç/g, "ch").replace(/ğ/g, "g").replace(/ö/g, "o").replace(/[’'ʼ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const VBYISO = {}; D.viloyatlar.features.forEach(f => VBYISO[f.properties.iso] = f);
const SBYID = {}; D.shaharlar.features.forEach(f => SBYID[did(f.properties.nomi)] = f);
// oflayn (baza ulanmaganda) — Milliy statistika qömitasi, 2026-yil 1-oktabr
const OFF = { "UZ-SA": 4462783, "UZ-FA": 4293001, "UZ-TO": 3799043, "UZ-QA": 3746228, "UZ-AN": 3574464, "UZ-TK": 3278512, "UZ-NG": 3190767, "UZ-SU": 3030030, "UZ-QR": 2166044, "UZ-XO": 2162068, "UZ-BU": 2125129, "UZ-JI": 1545176, "UZ-NW": 1196559, "UZ-SI": 965421 };
Object.entries(OFF).forEach(([iso, v]) => { const f = VBYISO[iso]; if (f) { f.properties.aholi = v; f.properties.aholi_sana = "2026-10-01"; f.properties.ziclik = v / f.properties.maydon_km2; } });

/* ---------- OCHIQ MA'LUMOTLAR: SIAT (stat.uz) API → ochiq/aholi.json ----------
   GitHub Actions har kuni tools/ochiq_yangilash.py ni ishga tushiradi: SIAT 246-indikator
   (doimiy aholi, respublika → viloyat → tuman, SOATO kodlari) faylga yoziladi va sayt
   har oçilganda / har soatda uni öqiydi. Viloyat va tumanlar KOD böyiça bog‘lanadi, nom böyiça emas. */
const SOATO_VIL = { 1735: "UZ-QR", 1703: "UZ-AN", 1706: "UZ-BU", 1708: "UZ-JI", 1710: "UZ-QA", 1712: "UZ-NW", 1714: "UZ-NG", 1718: "UZ-SA", 1722: "UZ-SU", 1724: "UZ-SI", 1726: "UZ-TK", 1727: "UZ-TO", 1730: "UZ-FA", 1733: "UZ-XO" };
const TBYSOATO = {}; TUM.features.forEach(f => { if (f.properties.soato) TBYSOATO[f.properties.soato] = f; });
const OCHIQ = { ok: false, yil: null, sana: null, olingan: null, manba: null, jami: null, yoq: {}, xato: "" };
function ochiqApply(j) {
  const rows = j.qatorlar || [], k = /ming/.test(j.birlik || "") ? 1000 : 1;
  rows.forEach(r => { const v = Math.round(r.qiymat * k); if (!isFinite(v)) return;
    if (r.kod.length === 4 && SOATO_VIL[r.kod]) { const f = VBYISO[SOATO_VIL[r.kod]]; if (f) { f.properties.aholi = v; f.properties.aholi_sana = j.sana; f.properties.ziclik = v / f.properties.maydon_km2; f.properties.aholi_manba = "SIAT"; } }
    else if (r.kod.length === 7 && TBYSOATO[r.kod]) { const p = TBYSOATO[r.kod].properties; p.aholi = v; p.ziclik = v / p.maydon_km2; } });
  const nat = rows.find(r => r.kod === "1700");
  OCHIQ.ok = true; OCHIQ.yil = j.yil; OCHIQ.sana = j.sana; OCHIQ.olingan = j.olingan; OCHIQ.manba = j.manba; OCHIQ.jami = nat ? Math.round(nat.qiymat * k) : null;
  OCHIQ.yoq = {}; (j.xaritada_yoq || []).forEach(r => { const f = VBYISO[SOATO_VIL[r.kod.slice(0, 4)]]; if (f) (OCHIQ.yoq[f.properties.nomi] = OCHIQ.yoq[f.properties.nomi] || []).push(r); });
}
function ochiqRender() {
  const el = $("#ochiqStatus"); if (!el) return;
  if (!OCHIQ.ok) { el.innerHTML = `<span class="dot"></span><b>Ochiq manba ulanmadi</b><span class="muted"> · ${esc(OCHIQ.xato || "yuklanmoqda…")} — ichki nusxa körsatilmoqda</span>`; return; }
  const yoq = Object.values(OCHIQ.yoq).flat();
  el.innerHTML = `<span class="dot on"></span><b>Ochiq ma’lumot: SIAT · stat.uz</b><span class="muted"> · doimiy aholi ${esc(OCHIQ.sana)} holatiga · Özbekiston: ${fmtI(OCHIQ.jami)} kişi · tekşirildi ${OCHIQ.olingan ? new Date(OCHIQ.olingan).toLocaleDateString("uz-UZ") : "—"}</span>
    <br><span class="muted">Indikator: <a href="${esc((OCHIQ.manba && OCHIQ.manba.sahifa) || "https://siat.stat.uz/")}" target="_blank" rel="noopener">${esc((OCHIQ.manba && OCHIQ.manba.indikator) || "SIAT")}</a> · 14 hudud va ${Object.keys(TBYSOATO).length} ta tuman/şahar SOATO kodi bilan bog‘langan.${yoq.length ? ` Xaritada çegarasi yöq yangi birliklar: ${yoq.length} ta (${yoq.map(r => esc(r.nomi)).join(", ")}).` : ""}</span>`;
}
async function ochiqLoad() {
  const tries = ["ochiq/aholi.json?v=" + Math.floor(Date.now() / 36e5), "https://api.siat.stat.uz/media/uploads/sdmx/sdmx_data_246.json"];
  for (const u of tries) {
    try { const r = await fetch(u, { cache: "no-cache" }); if (!r.ok) throw new Error("HTTP " + r.status); let j = await r.json();
      if (Array.isArray(j)) { const d = j[0].data, ys = Object.keys(d[0]).filter(x => /^\d{4}$/.test(x)).sort(), y = ys[ys.length - 1];
        j = { birlik: "ming kişi", yil: y, sana: y + "-01-01", olingan: new Date().toISOString(), manba: { indikator: "246 · Doimiy aholi soni (jami)", sahifa: "https://siat.stat.uz/data/246/" }, qatorlar: d.map(r => ({ kod: String(r.Code), nomi: r.Klassifikator, qiymat: +String(r[y]).replace(",", ".") })), xaritada_yoq: [] }; }
      ochiqApply(j); ochiqRender(); if (typeof bazaApply === "function") bazaApply(); else { redraw(); legendExt(); }
      return true; }
    catch (e) { OCHIQ.xato = "ochiq/aholi.json öqilmadi (" + (e && e.message || e) + ")"; }
  }
  ochiqRender(); return false;
}
const extOpts0 = $("#extMetric").innerHTML;
function fillExt() {
  const cur = $("#extMetric").value;
  $("#extMetric").innerHTML = extOpts0.replace('<option value="aholi">', '<option value="doimiy">Doimiy aholi (baza)</option><option value="ziclik">Aholi ziçligi (baza)</option><option value="aholi">') + BAZA.defs.map(d => `<option value="k:${esc(d.k)}">${esc(d.nomi)} (baza)</option>`).join("");
  $("#extMetric").value = [...$("#extMetric").options].some(o => o.value === cur) ? cur : EXT_METRIC;
}
fillExt();
function bazaApply() {
  Object.entries(BAZA.hud).forEach(([iso, d]) => { const f = VBYISO[iso]; if (!f) return; const p = f.properties;
    if (d.aholi != null && !(OCHIQ.ok && p.aholi_manba === "SIAT" && (d.sana || "") < OCHIQ.sana)) { p.aholi = +d.aholi; p.ziclik = p.aholi / p.maydon_km2; p.aholi_manba = "baza"; } p.aholi_sana = d.sana || p.aholi_sana;
    Object.keys(p).filter(k => k.startsWith("k_")).forEach(k => delete p[k]); Object.entries(d.k || {}).forEach(([k, v]) => p["k_" + k] = v); });
  Object.entries(BAZA.sha).forEach(([id, d]) => { const f = SBYID[id]; if (f && d.aholi != null) f.properties.aholi = +d.aholi; });
  D.viloyatlar.features.forEach(f => f.properties._aholi = 0);
  D.shaharlar.features.forEach(c => { if (c._vil) c._vil.properties._aholi += c.properties.aholi; });
  popMax = Math.max(...D.shaharlar.features.map(f => f.properties.aholi));
  citySelFill(); fillExt();
  if (BAZA.pendK && BAZA.defs.some(d => d.k === BAZA.pendK)) { EXT_METRIC = "k:" + BAZA.pendK; $("#extMetric").value = EXT_METRIC; BAZA.pendK = null; }
  redraw(); legendExt(); bazaRender();
}
const ago = t => { if (!t) return "—"; const s = (Date.now() - t) / 1000; return s < 60 ? "hozirgina" : s < 3600 ? Math.round(s / 60) + " daqiqa oldin" : s < 86400 ? Math.round(s / 3600) + " soat oldin" : new Date(t).toLocaleDateString("uz-UZ"); };
const NAMES = {};
async function bazaNames(ids) { if (!BAZA.user || !BAZA.user.profiles) return; const need = ids.filter(i => i && !(i in NAMES)); if (!need.length) return; try { const ps = await BAZA.user.profiles(need); need.forEach(i => NAMES[i] = (ps[i] && ps[i].name) || "Foydalanuvçi"); bazaRender(); } catch (e) {} }
function bazaRender() {
  const box = $("#bazaBody"); if (!box) return;
  const st = BAZA.live ? `<span class="dot on"></span><b>Jonli baza ulangan</b><span class="muted"> · yangilandi ${ago(BAZA.ts)}</span>` : `<span class="dot"></span><b>Oflayn rejim</b><span class="muted"> · ${esc(BAZA.note || "ichki ma’lumotlar (2026-yil 1-oktabr)")}</span>`;
  $("#bazaStatus").innerHTML = st;
  $("#bazaRole").textContent = !BAZA.live ? "" : BAZA.canWrite === false ? "Siz faqat körişingiz mumkin. Qiymatlarni platforma egasi va tahrirlovçilar özgartiradi." : "Siz qiymatlarni özgartira olasiz: katakni tahrirlab Enter bosing — xarita barça foydalanuvçilarda darhol yangilanadi.";
  const defs = [{ k: "aholi", nomi: "Doimiy aholi", birlik: "kişi" }, ...BAZA.defs];
  if (!defs.some(d => d.k === BAZA.k)) BAZA.k = "aholi";
  $("#bazaK").innerHTML = defs.map(d => `<option value="${esc(d.k)}"${d.k === BAZA.k ? " selected" : ""}>${esc(d.nomi)}${d.birlik ? ", " + esc(d.birlik) : ""}</option>`).join("");
  const ed = BAZA.live && BAZA.canWrite !== false;
  const val = f => BAZA.k === "aholi" ? f.properties.aholi : f.properties["k_" + BAZA.k];
  const rows = D.viloyatlar.features.slice().sort((a, b) => (+val(b) || 0) - (+val(a) || 0));
  const tot = rows.reduce((s, f) => s + (+val(f) || 0), 0);
  $("#bazaHud").innerHTML = `<tr><th>Hudud</th><th class="r">Qiymat</th>${BAZA.k === "aholi" ? '<th class="r">kişi/km²</th>' : ""}</tr>` + rows.map(f => { const p = f.properties, v = val(f), d = BAZA.hud[p.iso] || {};
    return `<tr title="${esc(d.sana ? "Sana: " + d.sana : "")}"><td>${esc(p.nomi.replace(" viloyati", " v."))}</td><td class="r">${ed ? `<input class="cell" data-iso="${p.iso}" inputmode="decimal" value="${v == null ? "" : v}">` : `<span class="num">${v == null ? "—" : fmt(v, Number.isInteger(+v) ? 0 : 1)}</span>`}</td>${BAZA.k === "aholi" ? `<td class="r num">${fmt(p.ziclik, 1)}</td>` : ""}</tr>`; }).join("") + `<tr class="tot"><td>Özbekiston</td><td class="r num">${fmt(tot, 0)}</td>${BAZA.k === "aholi" ? `<td class="r num">${fmt(tot / D.viloyatlar.features.reduce((s, f) => s + f.properties.maydon_km2, 0), 1)}</td>` : ""}</tr>`;
  $("#bazaSha").innerHTML = `<tr><th>Şahar</th><th class="r">Aholi</th></tr>` + D.shaharlar.features.slice().sort((a, b) => b.properties.aholi - a.properties.aholi).map(f => `<tr><td>${esc(f.properties.nomi)}</td><td class="r">${ed ? `<input class="cell" data-sha="${did(f.properties.nomi)}" inputmode="numeric" value="${f.properties.aholi}">` : `<span class="num">${fmtI(f.properties.aholi)}</span>`}</td></tr>`).join("");
  $("#bazaAdd").style.display = ed ? "" : "none";
  $("#bazaLog").innerHTML = BAZA.log.length ? BAZA.log.map(l => `<li><span class="muted">${ago(l.t)} · ${esc(NAMES[l.kim] || "…")}</span><br><b>${esc(l.obj)}</b> — ${esc(l.knom || l.k)}: <span class="num">${l.eski == null ? "—" : fmt(l.eski, Number.isInteger(+l.eski) ? 0 : 1)}</span> → <span class="num">${fmt(l.yangi, Number.isInteger(+l.yangi) ? 0 : 1)}</span></li>`).join("") : `<li class="muted">${BAZA.live ? "Hali özgariş yöq" : "Jurnal faqat baza ulanganda körinadi"}</li>`;
}
async function bazaSave(kind, id, raw, inp) {
  const v = raw.trim() === "" ? null : Number(raw.replace(/\s/g, "").replace(",", "."));
  if (v != null && (!isFinite(v) || v < 0)) { toast("Musbat son kiriting"); inp.value = ""; return; }
  const db = BAZA.db; if (!db) return;
  let obj, k, eski, ref, patch, knom;
  if (kind === "hud") { const d = BAZA.hud[id] || {}; obj = VBYISO[id].properties.nomi; k = BAZA.k; ref = db.doc("hududlar/" + id);
    const def = [{ k: "aholi", nomi: "Doimiy aholi" }, ...BAZA.defs].find(x => x.k === k); knom = def ? def.nomi : k;
    eski = k === "aholi" ? (d.aholi ?? VBYISO[id].properties.aholi) : (d.k || {})[k]; if (eski === v) return;
    patch = k === "aholi" ? { aholi: v, sana: new Date().toISOString().slice(0, 10) } : { k: { ...(d.k || {}), [k]: v } };
    if (!d.nomi) patch = { nomi: obj, ...patch }; }
  else { const d = BAZA.sha[id] || {}; obj = SBYID[id].properties.nomi; k = "aholi"; knom = "Aholi"; ref = db.doc("shaharlar/" + id); eski = d.aholi ?? SBYID[id].properties.aholi; if (eski === v || v == null) return; patch = { nomi: obj, aholi: v, sana: new Date().toISOString().slice(0, 10) }; }
  inp.disabled = true;
  try {
    const exists = kind === "hud" ? !!BAZA.hud[id] : !!BAZA.sha[id];
    if (exists) await ref.update(patch); else await ref.set(patch);
    try { await db.collection("jurnal").add({ t: Date.now(), kim: BAZA.uid || "", obj, k, knom, eski: eski ?? null, yangi: v }); } catch (e) {}
    toast("Saqlandi ✓ " + obj);
  } catch (e) {
    if (e && e.code === "invalid_argument") { BAZA.canWrite = false; bazaRender(); toast("Sizda özgartiriş huquqi yöq"); }
    else toast("Saqlanmadi: " + (e && e.message || e));
  }
  inp.disabled = false;
}
async function bazaInit() {
  bazaRender();
  if (!window.claude || !window.claude.use) { BAZA.note = "sahifa Claude tizimidan taşqarida oçilgan"; bazaRender(); return; }
  const [db, user] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
  BAZA.user = user;
  if (!db) { BAZA.note = "baza ulanmagan yoki tizimga kirilmagan — ički ma’lumotlar"; bazaRender(); return; }
  BAZA.db = db;
  try { BAZA.uid = user && user.id ? await user.id() : null; const cw = user && user.can ? await user.can("data.write") : null; BAZA.canWrite = cw == null ? null : !!cw; } catch (e) {}
  let first = true; const tmr = setTimeout(() => { if (!BAZA.live) { BAZA.note = "baza hozirça javob bermayapti — ički ma’lumotlar körsatilmoqda"; bazaRender(); } }, 10000);
  const mark = snap => { if (!snap.metadata.fromCache) { clearTimeout(tmr); BAZA.live = true; } BAZA.ts = Date.now(); };
  const onErr = e => { clearTimeout(tmr); BAZA.live = false; BAZA.note = "baza bilan aloqa uzildi (" + (e && e.code) + ")"; bazaRender(); };
  let pend = 0; const sched = () => { clearTimeout(pend); pend = setTimeout(bazaApply, 60); };
  db.collection("hududlar").onSnapshot(snap => { mark(snap); BAZA.hud = {}; snap.docs.forEach(d => BAZA.hud[d.id] = d.data()); if (first && snap.size) { first = false; if (EXT_METRIC === "plita") { EXT_METRIC = "doimiy"; $("#extMetric").value = "doimiy"; } } sched(); }, onErr);
  db.collection("shaharlar").onSnapshot(snap => { mark(snap); BAZA.sha = {}; snap.docs.forEach(d => BAZA.sha[d.id] = d.data()); sched(); }, onErr);
  db.doc("sozlamalar/korsatkichlar").onSnapshot(snap => { BAZA.defs = snap.exists ? (snap.data().list || []).filter(d => d && d.k && d.nomi) : []; sched(); }, onErr);
  db.collection("jurnal").orderBy("t", "desc").limit(15).onSnapshot(snap => { BAZA.log = snap.docs.map(d => d.data()); bazaNames(BAZA.log.map(l => l.kim)); bazaRender(); }, () => {});
}
$("#bazaK").addEventListener("change", e => { BAZA.k = e.target.value; bazaRender(); if (BAZA.k !== "aholi") { EXT_METRIC = "k:" + BAZA.k; } else EXT_METRIC = "doimiy"; $("#extMetric").value = EXT_METRIC; if (!IS3D) set3D(true); redraw(); legendExt(); });
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.classList && e.target.classList.contains("cell")) e.target.blur(); });
document.addEventListener("change", e => { const t = e.target; if (!t.classList || !t.classList.contains("cell")) return; if (t.dataset.iso) bazaSave("hud", t.dataset.iso, t.value, t); else if (t.dataset.sha) bazaSave("sha", t.dataset.sha, t.value, t); });
$("#bazaNewBtn").addEventListener("click", async () => {
  const nomi = $("#bazaNewN").value.trim(), birlik = $("#bazaNewB").value.trim(); if (!nomi) return toast("Körsatkiç nomini yozing");
  const k = did(nomi).slice(0, 40) || "k" + Date.now(); if (k === "aholi" || BAZA.defs.some(d => d.k === k)) return toast("Bunday körsatkiç bor");
  try { const ref = BAZA.db.doc("sozlamalar/korsatkichlar"), list = [...BAZA.defs, { k, nomi, birlik }]; await ref.set({ list }); BAZA.k = k; BAZA.pendK = k; $("#bazaNewN").value = $("#bazaNewB").value = ""; toast("Körsatkiç qöşildi: " + nomi); }
  catch (e) { toast("Qöşilmadi: " + (e && e.message || e)); }
});
$("#bazaExp").addEventListener("click", () => download("ozbekiston_hududlar_baza.csv", toCsv(["iso", "hudud", "doimiy_aholi", "zichlik_km2", "maydon_km2", ...BAZA.defs.map(d => d.k)], D.viloyatlar.features.map(f => { const p = f.properties; return [p.iso, p.nomi, p.aholi, +(p.ziclik || 0).toFixed(1), p.maydon_km2, ...BAZA.defs.map(d => p["k_" + d.k] ?? "")]; }))));
setInterval(() => { if (BAZA.live) bazaRender(); }, 60000);
window.bazaAuth = async () => { if (!BAZA.user) return; try { BAZA.uid = await BAZA.user.id(); const cw = await BAZA.user.can("data.write"); BAZA.canWrite = cw == null ? null : !!cw; } catch (e) { BAZA.canWrite = false; } bazaRender(); };
bazaInit();
ochiqLoad(); setInterval(ochiqLoad, 36e5);


/* =====================================================================
   SOHALAR — ustma-ust tahlilning 6 amaliy yönalişi
   Ma'lumot brauzerda jonli olinadi (hammasi oçiq, kalitsiz, CORS ruxsat etilgan):
     • OpenStreetMap (Overpass API) — maktab, poliklinika, yöl, kanal, sanoat, yer turlari
     • USGS Earthquake Catalog (FDSN) — 1960-yildan beri M ≥ 4 zilzilalar
     • Open-Meteo Historical Weather API — öttan 1 yillik kunlik shamol yönalişi
     • ETOPO1 (platformaga joylangan) — balandlik va nişablik
     • foydalanuvçi yuklagan GeoTIFF/Shapefile — tuproq, şörlaniş, kadastr uçastkalari
   ===================================================================== */
const SOHA = { cache: {}, reg: null, last: null };
const OVP = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const sLog = m => { const el = $("#sLog"); if (el) el.innerHTML = m; const b = $("#busyT"); if (b && $("#busy").classList.contains("on")) b.textContent = String(m).replace(/<[^>]+>/g, ""); };
function joinRings(segs) {
  const eq = (a, b) => a[0] === b[0] && a[1] === b[1], open = segs.filter(s => s.length > 1).map(s => s.slice()), rings = [];
  while (open.length) { let r = open.shift(), g = 0;
    while (!eq(r[0], r[r.length - 1]) && g++ < 5000) { const i = open.findIndex(s => eq(s[0], r[r.length - 1]) || eq(s[s.length - 1], r[r.length - 1])); if (i < 0) break; let s = open.splice(i, 1)[0]; if (!eq(s[0], r[r.length - 1])) s = s.reverse(); r = r.concat(s.slice(1)); }
    if (eq(r[0], r[r.length - 1]) && r.length >= 4) rings.push(r); }
  return rings;
}
function osm2fc(j) {
  const fs = [], ll = g => g.map(p => [p.lon, p.lat]);
  for (const e of j.elements || []) {
    const p = { ...(e.tags || {}), osm: e.type[0] + e.id };
    try {
      if (e.type === "node") fs.push(turf.point([e.lon, e.lat], p));
      else if (e.center) fs.push(turf.point([e.center.lon, e.center.lat], p));
      else if (e.type === "way" && e.geometry) { const c = ll(e.geometry), cl = c.length >= 4 && c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1];
        if (cl && !p.highway && !p.waterway) fs.push(turf.polygon([c], p)); else if (c.length >= 2) fs.push(turf.lineString(c, p)); }
      else if (e.type === "relation" && e.members) { const w = e.members.filter(m => m.type === "way" && m.geometry);
        if (p.type === "multipolygon" || p.landuse || p.natural) { const r = joinRings(w.filter(m => m.role !== "inner").map(m => ll(m.geometry))); if (r.length) fs.push(turf.multiPolygon(r.map(x => [x]), p)); }
        else if (w.length) fs.push(turf.multiLineString(w.map(m => ll(m.geometry)), p)); }
    } catch (er) { /* buzuq geometriya — tashlab ketiladi */ }
  }
  return { type: "FeatureCollection", features: fs };
}
// Bitta so'rov: bir nechta qatlam bitta Overpass so'roviga birlaştiriladi (server navbat va 429 xatosidan qoçiş)
async function overpassRaw(q, msg) {
  let err;
  for (const u of OVP) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 70000);
    try { const r = await fetch(u, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: ac.signal });
      if (!r.ok) throw new Error("HTTP " + r.status + (r.status === 429 ? " (server band)" : r.status === 504 ? " (server yuklangan)" : ""));
      const j = await r.json(); clearTimeout(t); if (j.remark && /error|timed out/i.test(j.remark) && !(j.elements || []).length) throw new Error(j.remark); return j; }
    catch (e) { clearTimeout(t); err = e.name === "AbortError" ? new Error("70 s ichida javob kelmadi") : e; sLog(`${msg} — ${new URL(u).host} javob bermadi (${esc(err.message)}), boşqa serverga ötilmoqda…`); }
  }
  throw new Error("OpenStreetMap (Overpass) serverlari javob bermadi: " + (err && err.message || err) + ". Bir daqiqadan keyin qayta urinib köring yoki kiçikroq hududni (tumanni) tanlang.");
}
const OSMQ = {
  maktab: ['nwr["amenity"~"^(school|kindergarten)$"](BB);', "center"],
  tibbiyot: ['nwr["amenity"~"^(clinic|hospital|doctors)$"](BB);nwr["healthcare"~"^(clinic|hospital|centre|doctor)$"](BB);', "center"],
  yol: ['way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street)$"](BB);', "geom"],
  yolKatta: ['way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](BB);', "geom"],
  turar: ['way["landuse"="residential"](BB);relation["landuse"="residential"](BB);', "geom"],
  suv: ['way["waterway"~"^(river|canal)$"](BB);', "geom"],
  suvMayda: ['way["waterway"~"^(river|canal|stream|ditch|drain)$"](BB);', "geom"],
  ekin: ['way["landuse"~"^(farmland|orchard|vineyard)$"](BB);relation["landuse"~"^(farmland|orchard|vineyard)$"](BB);', "geom"],
  sanoat: ['way["landuse"="industrial"](BB);nwr["man_made"="works"](BB);nwr["power"="plant"](BB);', "geom"],
  yer: ['way["landuse"](BB);relation["landuse"](BB);way["natural"~"^(wood|water|wetland|scrub|grassland|bare_rock|sand)$"](BB);relation["natural"~"^(wood|water|wetland)$"](BB);', "geom"]
};
const OSMT = {
  maktab: t => /^(school|kindergarten)$/.test(t.amenity || ""),
  tibbiyot: t => /^(clinic|hospital|doctors)$/.test(t.amenity || "") || /^(clinic|hospital|centre|doctor)$/.test(t.healthcare || ""),
  yol: t => /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street)$/.test(t.highway || ""),
  yolKatta: t => /^(motorway|trunk|primary|secondary|tertiary)$/.test(t.highway || ""),
  turar: t => t.landuse === "residential",
  suv: t => /^(river|canal)$/.test(t.waterway || ""),
  suvMayda: t => /^(river|canal|stream|ditch|drain)$/.test(t.waterway || ""),
  ekin: t => /^(farmland|orchard|vineyard)$/.test(t.landuse || ""),
  sanoat: t => t.landuse === "industrial" || t.man_made === "works" || t.power === "plant",
  yer: t => !!t.landuse || /^(wood|water|wetland|scrub|grassland|bare_rock|sand)$/.test(t.natural || "")
};
async function osmGet(keys, bb) {
  const ck = k => k + "|" + bb.map(x => x.toFixed(3)).join(","), need = keys.filter(k => !SOHA.cache[ck(k)]);
  if (need.length) {
    const b = `${bb[1].toFixed(4)},${bb[0].toFixed(4)},${bb[3].toFixed(4)},${bb[2].toFixed(4)}`;
    const P = need.filter(k => OSMQ[k][1] === "center").map(k => OSMQ[k][0]).join(""), Gq = need.filter(k => OSMQ[k][1] === "geom").map(k => OSMQ[k][0]).join("");
    const q = `[out:json][timeout:60][maxsize:200000000];${P ? `(${P})->.p;.p out center;` : ""}${Gq ? `(${Gq})->.g;.g out geom;` : ""}`.replace(/BB/g, b);
    const t0 = Date.now(), msg = "OpenStreetMap: " + need.join(", ") + " olinmoqda";
    const tick = setInterval(() => sLog(`${msg}… ${Math.round((Date.now() - t0) / 1000)} s`), 1000);
    let j; try { j = await overpassRaw(q, msg); } finally { clearInterval(tick); }
    const fc = osm2fc(j);
    need.forEach(k => { SOHA.cache[ck(k)] = { type: "FeatureCollection", features: fc.features.filter(f => OSMT[k](f.properties || {})).map(f => OSMQ[k][1] === "center" && f.geometry.type !== "Point" ? turf.feature(turf.pointOnFeature(f).geometry, f.properties) : f) }; });
    sLog(`OpenStreetMap: ${fc.features.length} obyekt olindi (${((Date.now() - t0) / 1000).toFixed(1)} s). Hisoblanmoqda…`); await sleep(20);
  }
  return keys.map(k => SOHA.cache[ck(k)]);
}
async function quakes(bb) {
  const k = "usgs"; if (SOHA.cache[k]) return SOHA.cache[k];
  const u = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=1960-01-01&minmagnitude=4&minlatitude=34&maxlatitude=48&minlongitude=54&maxlongitude=77&orderby=magnitude&limit=20000`;
  const r = await fetch(u, { signal: AbortSignal.timeout(40000) }).catch(e => { throw new Error("USGS zilzila katalogi 40 s ichida javob bermadi"); }); if (!r.ok) throw new Error("USGS zilzila katalogi javob bermadi (HTTP " + r.status + ")");
  const j = await r.json(); SOHA.cache[k] = j; return j;
}
async function windRose(lon, lat) {
  const k = "wind|" + lon.toFixed(1) + "," + lat.toFixed(1); if (SOHA.cache[k]) return SOHA.cache[k];
  const e = new Date(Date.now() - 6 * 864e5), s = new Date(e.getTime() - 365 * 864e5), d = x => x.toISOString().slice(0, 10);
  const u = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&start_date=${d(s)}&end_date=${d(e)}&daily=wind_direction_10m_dominant,wind_speed_10m_max&timezone=Asia%2FTashkent`;
  const r = await fetch(u, { signal: AbortSignal.timeout(40000) }).catch(e => { throw new Error("Open-Meteo 40 s ichida javob bermadi"); }); if (!r.ok) throw new Error("Open-Meteo shamol arxivi javob bermadi (HTTP " + r.status + ")");
  const j = await r.json(), dir = j.daily.wind_direction_10m_dominant, sp = j.daily.wind_speed_10m_max;
  const f = new Array(8).fill(0), v = new Array(8).fill(0); let n = 0;
  dir.forEach((a, i) => { if (a == null) return; const sct = Math.round(a / 45) % 8; f[sct]++; v[sct] += sp[i] || 0; n++; });
  const out = { f: f.map(x => x / Math.max(1, n)), v: v.map((x, i) => f[i] ? x / f[i] : 0), n, dan: d(s), gacha: d(e) }; SOHA.cache[k] = out; return out;
}
const RUMB = ["şimol", "şimoli-şarq", "şarq", "janubi-şarq", "janub", "janubi-ğarb", "ğarb", "şimoli-ğarb"];

/* ---------- hudud va tahlil to'ri ---------- */
function sohaRegion() {
  const v = $("#sVil").value, t = $("#sTum").value; if (!v) return null;
  if (t) { const f = TUM.features.find(x => x.properties.viloyat === v && x.properties.nomi === t); return f ? { nomi: t + (f.properties.turi === "tuman" ? " tumani" : ""), vil: v, f, tuman: true } : null; }
  const f = D.viloyatlar.features.find(x => x.properties.nomi === v); return f ? { nomi: v, vil: v, f, tuman: false } : null;
}
function gridBB(bb, resKm) {
  const [x0, y1] = merc(bb[0], bb[1]), [x1, y0] = merc(bb[2], bb[3]), cs = resKm * 1000 / Math.cos((bb[1] + bb[3]) / 2 * Math.PI / 180);
  const W = Math.max(2, Math.ceil((x1 - x0) / cs)), H = Math.max(2, Math.ceil((y0 - y1) / cs)), lat = new Float32Array(H), tcs = new Float32Array(H);
  for (let i = 0; i < H; i++) { lat[i] = imerc(0, y0 - (i + .5) * cs)[1]; tcs[i] = cs * Math.cos(lat[i] * Math.PI / 180) / 1000; }
  const lon = new Float32Array(W); for (let j = 0; j < W; j++) lon[j] = imerc(x0 + (j + .5) * cs, 0)[0];
  return { x0, y0, cs, W, H, n: W * H, lat, lon, tcs, resKm };
}
function regGrid(reg, maxCells = 60000) {
  const km2 = turf.area(reg.f) / 1e6, res = Math.max(.08, +Math.sqrt(km2 * 1.6 / maxCells).toFixed(3));
  const G = gridBB(turf.bbox(reg.f), res); G.mask = rasterize([reg.f], "fill", G); G.km2 = km2; return G;
}
const cellAt = (G, lon, lat) => { const [x, y] = merc(lon, lat), j = Math.floor((x - G.x0) / G.cs), i = Math.floor((G.y0 - y) / G.cs); return i < 0 || j < 0 || i >= G.H || j >= G.W ? -1 : i * G.W + j; };
const cellArea = (G, k) => { const t = G.tcs[Math.floor(k / G.W)]; return t * t; };
const inReg = (reg, fs) => fs.filter(f => safe(() => { const c = f.geometry.type === "Point" ? f : turf.pointOnFeature(f); return turf.booleanPointInPolygon(c, reg.f); }));
const distKm = (fs, mode, G) => fs.length ? edt(rasterize(fs, mode, G), G) : new Float32Array(G.n).fill(1e9);
const trap = (x, a, b, c, d) => x <= a || x >= d ? 0 : x < b ? (x - a) / (b - a) : x <= c ? 1 : (d - x) / (d - c);
const lerpC = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
const RISK_C = t => t < .5 ? lerpC([46, 204, 113], [247, 209, 84], t * 2) : lerpC([247, 209, 84], [255, 79, 139], (t - .5) * 2);
function sohaCells(name, G, vals, colorFn, tipFn, note) {
  const cells = []; for (let k = 0; k < G.n; k++) { const v = vals[k]; if (!(v >= 0) || !G.mask[k]) continue; const i = Math.floor(k / G.W), j = k % G.W; cells.push({ k, p: [G.lon[j], G.lat[i]], v }); }
  const rad = G.resKm * 1000 / Math.SQRT2 * .97, hm = Math.min(6000, G.resKm * 1000 * 5), id = "soc" + (uid + 1);
  const [lo0, la1] = imerc(G.x0, G.y0), [lo1, la0] = imerc(G.x0 + G.W * G.cs, G.y0 - G.H * G.cs);
  return addLayer(name, null, { kind: "raster", derived: true, note, bbox: [lo0, la0, lo1, la1], build: ctx => [new ColumnLayer({ id, data: cells, getPosition: d => [d.p[0], d.p[1], pz(d.p[0], d.p[1])], diskResolution: 4, angle: 45, radius: rad, extruded: ctx.is3D, material: MAT, getElevation: d => baseH() + 40 + hm * ctx.exag * d.v, getFillColor: colorFn, pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 110], tipFn, parameters: { depthCompare: ctx.is3D ? "less-equal" : "always" }, updateTriggers: { getElevation: [ctx.exag] } })] });
}
const ptStyle = (r = 5) => () => ({ radius: r });
const sTable = (head, rows) => `<table class="t"><tr>${head.map((h, i) => `<th${i ? ' class="r"' : ""}>${esc(h)}</th>`).join("")}</tr>${rows.map(r => `<tr>${r.map((c, i) => `<td${i ? ' class="r num"' : ""}>${typeof c === "number" ? fmt(c, Number.isInteger(c) ? 0 : 1) : esc(c)}</td>`).join("")}</tr>`).join("")}</table>`;
const srcNote = s => `<p class="small muted">Manba: ${s}</p>`;
const nm = p => p.name || p["name:uz"] || p["name:ru"] || "nomsiz";

/* ---------- 1. Qişloq xöjaligi: qaysi dalaga qaysi ekin ---------- */
const EKIN = [
  { k: "paxta", nomi: "Paxta", c: [245, 245, 245], nish: [-1, 0, 2, 5], bal: [100, 200, 600, 900], suv: 6 },
  { k: "bugdoy", nomi: "Buğdoy (ğalla)", c: [233, 196, 106], nish: [-1, 0, 5, 12], bal: [100, 200, 1200, 1800], suv: 15 },
  { k: "bog", nomi: "Bog‘ va uzumzor", c: [126, 211, 33], nish: [0, 2, 12, 20], bal: [250, 400, 1400, 1900], suv: 4 },
  { k: "sabzavot", nomi: "Sabzavot va poliz", c: [255, 140, 66], nish: [-1, 0, 2, 4], bal: [100, 200, 900, 1300], suv: 2 }
];
async function sohaQishloq(reg, opt) {
  const bb = turf.bbox(reg.f), G = regGrid(reg);
  sLog("OpenStreetMap: kanal, daryo va ekin maydonlari olinmoqda…");
  const [suv, ekin] = await osmGet(["suvMayda", "ekin"], bb);
  const dSuv = distKm(suv.features, "stroke", G);
  const dem = sampleUser({ sample: demAt }, G, false), sl = sampleUser({ sample: demAt }, G, true);
  const ur = k => { const n = $(k).value; return n ? USER_RASTERS.find(r => r.name === n) : null; }, rT = ur("#sTuproq"), rS = ur("#sShor");
  const tup = rT ? sampleUser(rT, G, false) : null, sho = rS ? sampleUser(rS, G, false) : null;
  const ns = (a, r) => { if (!a) return null; let lo = Infinity, hi = -Infinity; for (let k = 0; k < G.n; k++) if (G.mask[k] && isFinite(a[k])) { lo = Math.min(lo, a[k]); hi = Math.max(hi, a[k]); } return k => hi > lo && isFinite(a[k]) ? (a[k] - lo) / (hi - lo) : .5; };
  const nT = ns(tup), nS = ns(sho);
  const fields = inReg(reg, ekin.features.filter(isPoly)), fmask = fields.length && opt.faqatDala ? rasterize(fields, "fill", G) : null;
  const best = new Int8Array(G.n).fill(-1), bestS = new Float32Array(G.n).fill(NaN), score = EKIN.map(() => new Float32Array(G.n));
  for (let k = 0; k < G.n; k++) { if (!G.mask[k] || (fmask && !fmask[k])) continue;
    let bi = -1, bs = 0;
    EKIN.forEach((e, i) => { const m = [trap(sl[k], ...e.nish), trap(dem[k], ...e.bal), Math.max(0, 1 - dSuv[k] / e.suv)]; if (nT) m.push(.2 + .8 * nT(k)); if (nS) m.push(e.k === "bugdoy" ? 1 - .6 * nS(k) : 1 - .9 * nS(k));
      const s = m.some(x => x <= 0) ? 0 : Math.pow(m.reduce((a, b) => a * b, 1), 1 / m.length); score[i][k] = s; if (s > bs) { bs = s; bi = i; } });
    best[k] = bs >= .25 ? bi : -1; bestS[k] = bs; }
  const area = EKIN.map(() => 0); for (let k = 0; k < G.n; k++) if (best[k] >= 0) area[best[k]] += cellArea(G, k);
  const lay = sohaCells(`Ekin mosligi · ${reg.nomi}`, G, bestS, d => best[d.k] < 0 ? [90, 90, 100, 160] : [...EKIN[best[d.k]].c, 235],
    d => ({ title: best[d.k] < 0 ? "Ekinga yaroqsiz / past moslik" : "Eng mos: " + EKIN[best[d.k]].nomi, props: Object.fromEntries([...EKIN.map((e, i) => [e.nomi, score[i][d.k].toFixed(2)]), ["nişablik, °", sl[d.k].toFixed(1)], ["balandlik, m", Math.round(dem[d.k])], ["suvga masofa, km", dSuv[d.k].toFixed(2)]]) }), "Qişloq xöjaligi moslik xaritasi");
  let fl = null, frows = [];
  if (fields.length) {
    const ff = fields.slice(0, 4000).map(f => { const c = turf.pointOnFeature(f).geometry.coordinates, k = cellAt(G, c[0], c[1]), b = k >= 0 ? best[k] : -1; return turf.feature(f.geometry, { nomi: nm(f.properties), "OSM turi": f.properties.landuse, "tavsiya ekin": b >= 0 ? EKIN[b].nomi : "past moslik", moslik: k >= 0 ? +bestS[k].toFixed(2) : null, "maydon, ga": +(turf.area(f) / 1e4).toFixed(1), _b: b }); });
    fl = addLayer(`Dalalar va tavsiya · ${reg.nomi}`, fcOf(ff), { derived: true, style: { stroke: "#ffffff", fill: "#ffffff", fillOpacity: .5, weight: 1 }, styleFn: f => ({ color: "#0B2545", weight: .6, fillColor: f.properties._b >= 0 ? "#" + EKIN[f.properties._b].c.map(x => x.toString(16).padStart(2, "0")).join("") : "#666666", fillOpacity: .75 }) });
    frows = ff.map(f => f.properties);
  }
  const html = `<div class="kpis">${EKIN.map((e, i) => `<div class="kpi"><b class="num">${fmt(area[i], 1)}</b><span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:rgb(${e.c})"></i> ${esc(e.nomi)}, km²</span></div>`).join("")}</div>
    <p class="small">Har bir katak (${fmt(G.resKm * 1000, 0)} m) uçun 4 ekinning moslik balli hisoblandi, eng yuqorisi tanlandi. Mezonlar: nişablik, dengiz sathidan balandlik, kanal/daryoga masofa${rT ? ", tuproq (" + esc(rT.name) + ")" : ""}${rS ? ", şörlaniş (" + esc(rS.name) + ")" : ""}.</p>
    ${fields.length ? sTable(["Ekin", "dalalar soni", "maydon, ga"], EKIN.map((e, i) => { const r = frows.filter(p => p._b === i); return [e.nomi, r.length, r.reduce((s, p) => s + p["maydon, ga"], 0)]; })) : `<p class="small" style="color:var(--warn)">⚠ OpenStreetMap'da bu hududda ekin maydoni çizilmagan — butun hudud böyiça hisoblandi.</p>`}
    ${!rT && !rS ? `<p class="small" style="color:var(--warn)">Tuproq va şörlaniş oçiq bazalarda tuman aniqligida yöq. Ularni GeoTIFF qilib “Qatlamlar → Öz maʼlumotingizni qöşiş” orqali yuklasangiz, şu yerda mezon sifatida tanlanadi.</p>` : ""}
    ${srcNote("OpenStreetMap (kanal, daryo, ekin maydonlari) · ETOPO1 (balandlik, nişablik, ~18 km — tog‘li hududda umumlaştirilgan) · foydalanuvçi rasterlari")}`;
  return { lay: fl || lay, html, csv: ["ekin_mosligi_" + slug(reg.nomi) + ".csv", fields.length ? toCsv(["dala", "osm_turi", "tavsiya_ekin", "moslik", "maydon_ga"], frows.map(p => [p.nomi, p["OSM turi"], p["tavsiya ekin"], p.moslik, p["maydon, ga"]])) : toCsv(["ekin", "maydon_km2"], EKIN.map((e, i) => [e.nomi, +area[i].toFixed(2)]))] };
}

/* ---------- 2. Şaharsozlik: maktab, poliklinika va yöllarga yaqin mahallalar ---------- */
async function sohaShahar(reg, opt) {
  const bb = turf.bbox(reg.f), G = regGrid(reg, 70000);
  sLog("OpenStreetMap: maktablar, tibbiyot muassasalari, yöllar va turar joylar olinmoqda…");
  const [mk, tb, yl, tj] = await osmGet(["maktab", "tibbiyot", reg.tuman ? "yol" : "yolKatta", "turar"], bb);
  const schools = inReg(reg, mk.features), clinics = inReg(reg, tb.features), res = inReg(reg, tj.features.filter(isPoly));
  if (!res.length) throw new Error("OpenStreetMap'da bu hududda turar joy (landuse=residential) çizilmagan. Boşqa tumanni tanlang.");
  const rm = rasterize(res, "fill", G), dS = distKm(schools, "point", G), dC = distKm(clinics, "point", G), dR = distKm(yl.features, "stroke", G);
  const Rs = opt.rMaktab / 1000, Rc = opt.rKlinika / 1000, Rr = opt.rYol / 1000;
  const sc = new Float32Array(G.n).fill(NaN), cls = [0, 0, 0, 0];
  for (let k = 0; k < G.n; k++) { if (!G.mask[k] || !rm[k]) continue; const s = (dS[k] <= Rs) + (dC[k] <= Rc) + (dR[k] <= Rr); sc[k] = s / 3; cls[s] += cellArea(G, k); }
  // eng kam ta'minlangan joy: maktabdan eng uzoq turar-joy katagi
  let far = -1, fk = -1; for (let k = 0; k < G.n; k++) if (sc[k] >= 0 && dS[k] > far && dS[k] < 1e8) { far = dS[k]; fk = k; }
  const C3 = [[255, 79, 139], [255, 159, 67], [247, 209, 84], [46, 204, 113]];
  const lay = sohaCells(`Xizmatlarga yaqinlik · ${reg.nomi}`, G, sc, d => [...C3[Math.round(d.v * 3)], 235], d => ({ title: ["Heç biriga yaqin emas", "Bittasiga yaqin", "Ikkitasiga yaqin", "Uçalasiga yaqin"][Math.round(d.v * 3)], props: { "maktabgaça, km": dS[d.k] < 1e8 ? dS[d.k].toFixed(2) : "—", "tibbiyotgaça, km": dC[d.k] < 1e8 ? dC[d.k].toFixed(2) : "—", "yölgaça, km": dR[d.k] < 1e8 ? dR[d.k].toFixed(2) : "—" } }), "Turar joylarning maktab, poliklinika va yöllarga yaqinligi");
  addLayer(`Maktab va bog‘çalar · ${reg.nomi}`, fcOf(schools.map(f => turf.feature(f.geometry, { nomi: nm(f.properties), turi: f.properties.amenity }))), { derived: true, style: { stroke: "#0B2545", fill: "#5BB8FF" }, pointStyle: ptStyle(5) });
  addLayer(`Tibbiyot muassasalari · ${reg.nomi}`, fcOf(clinics.map(f => turf.feature(f.geometry, { nomi: nm(f.properties), turi: f.properties.amenity || f.properties.healthcare }))), { derived: true, style: { stroke: "#0B2545", fill: "#FF4F8B" }, pointStyle: ptStyle(6) });
  const per = res.slice(0, 3000).map(f => { let a = 0, n = 0; const b = turf.bbox(f), m = rasterize([f], "fill", G); for (let k = 0; k < G.n; k++) if (m[k] && sc[k] >= 0) { a += sc[k]; n++; } return { nomi: nm(f.properties), s: n ? a / n : null, ga: turf.area(f) / 1e4 }; }).filter(r => r.s != null).sort((a, b) => a.s - b.s);
  const tot = cls.reduce((a, b) => a + b, 0) || 1, ctr = fk >= 0 ? [G.lon[fk % G.W], G.lat[Math.floor(fk / G.W)]] : null;
  if (ctr) addLayer(`Yangi maktab uçun tavsiya · ${reg.nomi}`, fcOf([turf.point(ctr, { tavsiya: "Yangi maktab", "eng yaqin maktabgaça, km": +far.toFixed(2) })]), { derived: true, style: { stroke: "#ffffff", fill: "#F2B84B" }, pointStyle: ptStyle(10) });
  const html = `<div class="kpis"><div class="kpi"><b class="num">${schools.length}</b><span>maktab va bog‘ça</span></div><div class="kpi"><b class="num">${clinics.length}</b><span>tibbiyot muassasasi</span></div><div class="kpi"><b class="num">${fmt(tot, 1)}</b><span>turar joy, km²</span></div><div class="kpi"><b class="num">${fmt(cls[3] / tot * 100, 0)}%</b><span>uçalasiga yaqin</span></div></div>
    ${sTable(["Ta’minlanganlik", "km²", "%"], [["Uçalasiga yaqin", cls[3], cls[3] / tot * 100], ["Ikkitasiga", cls[2], cls[2] / tot * 100], ["Bittasiga", cls[1], cls[1] / tot * 100], ["Heç biriga", cls[0], cls[0] / tot * 100]])}
    <p class="small">Mezon: maktab ≤ ${opt.rMaktab} m, poliklinika ≤ ${opt.rKlinika} m, yöl ≤ ${opt.rYol} m. Bu üç qatlamning bufer zonalari turar joylar bilan ustma-ust qöyildi (Intersect).</p>
    ${ctr ? `<p class="small">⭐ Yangi maktab uçun tavsiya: maktabdan eng uzoq (${fmt(far, 2)} km) turar joy — xaritada sariq nuqta.</p>` : ""}
    <h3>Eng kam ta’minlangan mahallalar</h3>${sTable(["Turar joy", "ball (0–1)", "ga"], per.slice(0, 12).map(r => [r.nomi, r.s, r.ga]))}
    ${srcNote("OpenStreetMap — amenity=school/kindergarten/clinic/hospital/doctors, highway=*, landuse=residential. OSM’da çizilmagan obyektlar hisobga kirmaydi.")}`;
  return { lay, html, csv: ["shaharsozlik_" + slug(reg.nomi) + ".csv", toCsv(["turar_joy", "ball", "maydon_ga"], per.map(r => [r.nomi, +r.s.toFixed(3), +r.ga.toFixed(1)]))] };
}

/* ---------- 3. Favqulodda vaziyatlar: seysmik faollik + sel yöli + maktablar ---------- */
async function sohaFavq(reg, opt) {
  const bb = turf.bbox(reg.f), G = regGrid(reg);
  sLog("USGS zilzila katalogi, OpenStreetMap soy/daryo va maktablar olinmoqda…");
  const eq = await quakes(bb), [wt, mk] = await osmGet(["suvMayda", "maktab"], bb);
  const Q = eq.features.filter(f => f.properties.mag >= 4).map(f => ({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], m: f.properties.mag }));
  const seis = new Float32Array(G.n), dW = distKm(wt.features, "stroke", G), dem = sampleUser({ sample: demAt }, G, false), sl = sampleUser({ sample: demAt }, G, true);
  const near = Q.filter(q => q.lon > bb[0] - 3 && q.lon < bb[2] + 3 && q.lat > bb[1] - 3 && q.lat < bb[3] + 3);
  for (let k = 0; k < G.n; k++) { if (!G.mask[k]) continue; const lo = G.lon[k % G.W], la = G.lat[Math.floor(k / G.W)]; let h = 0;
    for (const q of near) { const dx = (q.lon - lo) * 111.3 * Math.cos(la * Math.PI / 180), dy = (q.lat - la) * 111.3, d = Math.hypot(dx, dy); h += Math.pow(10, .75 * (q.m - 4)) * Math.exp(-d / 30); }
    seis[k] = 1 - Math.exp(-h / 4); }
  const sel = new Float32Array(G.n), risk = new Float32Array(G.n).fill(NaN);
  for (let k = 0; k < G.n; k++) { if (!G.mask[k]) continue; const mtn = Math.max(0, Math.min(1, (dem[k] - 500) / 1000)) * Math.max(.3, Math.min(1, sl[k] / 4)); sel[k] = mtn * Math.max(0, 1 - dW[k] / (opt.selKm || .5)); risk[k] = 1 - (1 - .8 * seis[k]) * (1 - sel[k]); }
  const sch = inReg(reg, mk.features).map(f => { const c = f.geometry.coordinates, k = cellAt(G, c[0], c[1]); return turf.feature(f.geometry, { nomi: nm(f.properties), turi: f.properties.amenity, "xavf (0–1)": k >= 0 ? +risk[k].toFixed(2) : null, "seysmik": k >= 0 ? +seis[k].toFixed(2) : null, "sel": k >= 0 ? +sel[k].toFixed(2) : null }); }).filter(f => f.properties["xavf (0–1)"] != null).sort((a, b) => b.properties["xavf (0–1)"] - a.properties["xavf (0–1)"]);
  const lay = sohaCells(`Xavf xaritasi · ${reg.nomi}`, G, risk, d => [...RISK_C(d.v), 230], d => ({ title: "Xavf indeksi " + d.v.toFixed(2), props: { "seysmik faollik": seis[d.k].toFixed(2), "sel xavfi": sel[d.k].toFixed(2), "balandlik, m": Math.round(dem[d.k]), "soy/daryogaça, km": dW[d.k] < 1e8 ? dW[d.k].toFixed(2) : "—" } }), "Seysmik faollik + sel yöli");
  addLayer(`Maktablar xavf böyiça · ${reg.nomi}`, fcOf(sch), { derived: true, style: { stroke: "#0B2545", fill: "#fff" }, pointStyle: ptStyle(6), styleFn: f => { const c = RISK_C(f.properties["xavf (0–1)"]); return { fillColor: "#" + c.map(x => x.toString(16).padStart(2, "0")).join(""), fillOpacity: 1, color: "#0B2545" }; } });
  const qn = near.filter(q => turf.booleanPointInPolygon([q.lon, q.lat], turf.buffer(reg.f, 50, { units: "kilometers" })));
  if (qn.length) addLayer(`Zilzilalar M≥4 (1960–) · ${reg.nomi} ±50 km`, fcOf(qn.map(q => turf.point([q.lon, q.lat], { magnituda: q.m }))), { derived: true, style: { stroke: "#FF4F8B", fill: "#FF4F8B", fillOpacity: .5 }, pointStyle: f => ({ radius: 2 + (f.properties.magnituda - 3.5) * 3 }) });
  const hi = sch.filter(f => f.properties["xavf (0–1)"] >= .6).length;
  const html = `<div class="kpis"><div class="kpi"><b class="num">${qn.length}</b><span>zilzila M≥4, 1960-yildan (±50 km)</span></div><div class="kpi"><b class="num">${qn.length ? Math.max(...qn.map(q => q.m)).toFixed(1) : "—"}</b><span>eng kuçli magnituda</span></div><div class="kpi"><b class="num">${sch.length}</b><span>maktab va bog‘ça</span></div><div class="kpi"><b class="num">${hi}</b><span>yuqori xavfda (≥ 0.6)</span></div></div>
    <h3>Eng xavfli joydagi maktablar</h3>${sTable(["Muassasa", "xavf", "seysmik", "sel"], sch.slice(0, 15).map(f => [f.properties.nomi, f.properties["xavf (0–1)"], f.properties.seysmik, f.properties.sel]))}
    <p class="small">Xavf = 1 − (1 − 0.8·seysmik)·(1 − sel). Seysmik faollik — yaqin zilzilalar magnitudasi va masofasi böyiça nisbiy indeks; sel — tog‘li (> 500 m) va nişab joyda soy/daryo yaqinligi (≤ ${opt.selKm} km).</p>
    <p class="small" style="color:var(--warn)">⚠ Bu öquv modeli. Rasmiy seysmik rayonlaştiriş xaritasi (ŞNQ) va Favqulodda vaziyatlar vazirligining sel xaritalari oçiq emas; ular bölsa, Shapefile qilib yuklab, Overlay bölimida ustma-ust qöyiş mumkin.</p>
    ${srcNote("USGS Earthquake Catalog (FDSN API) · OpenStreetMap (waterway, amenity=school) · ETOPO1")}`;
  return { lay, html, csv: ["xavf_maktablar_" + slug(reg.nomi) + ".csv", toCsv(["muassasa", "turi", "xavf", "seysmik", "sel", "lon", "lat"], sch.map(f => [f.properties.nomi, f.properties.turi, f.properties["xavf (0–1)"], f.properties.seysmik, f.properties.sel, ...f.geometry.coordinates.map(x => +x.toFixed(5))]))] };
}

/* ---------- 4. Suv xöjaligi: muhofaza zonalari va suv taqsimoti ---------- */
async function sohaSuv(reg, opt) {
  const bb = turf.bbox(reg.f), G = regGrid(reg);
  sLog("OpenStreetMap: daryo, kanal, ekin maydonlari va qurilişlar olinmoqda…");
  const [sv, ek, tj, sn] = await osmGet(["suv", "ekin", "turar", "sanoat"], bb);
  const riv = sv.features.filter(f => f.properties.waterway === "river"), can = sv.features.filter(f => f.properties.waterway === "canal");
  sLog("Muhofaza zonalari (bufer) qurilmoqda…"); await sleep(20);
  const zR = bufferFs(riv, opt.zDaryo / 1000, true), zC = bufferFs(can, opt.zKanal / 1000, true);
  const zone = dissolveAll([...zR, ...zC].map(f => turf.feature(f.geometry, {}))), zClip = zone ? safe(() => turf.intersect(turf.featureCollection([zone, reg.f]))) : null;
  const zKm2 = zClip ? turf.area(zClip) / 1e6 : 0;
  const built = inReg(reg, [...tj.features, ...sn.features].filter(isPoly)), hit = zClip ? built.map(f => safe(() => turf.intersect(turf.featureCollection([f, zClip])))).filter(Boolean) : [];
  const hitKm2 = hit.reduce((s, f) => s + turf.area(f) / 1e6, 0);
  const dC = distKm(can, "stroke", G), fields = inReg(reg, ek.features.filter(isPoly));
  const cls = [0, 0, 0], ff = fields.slice(0, 4000).map(f => { const c = turf.pointOnFeature(f).geometry.coordinates, k = cellAt(G, c[0], c[1]), d = k >= 0 ? dC[k] : 1e9, ga = turf.area(f) / 1e4, i = d <= .5 ? 0 : d <= 2 ? 1 : 2; cls[i] += ga; return turf.feature(f.geometry, { "kanalgaça, km": d < 1e8 ? +d.toFixed(2) : null, "maydon, ga": +ga.toFixed(1), _i: i }); });
  const lenR = riv.reduce((s, f) => s + turf.length(f), 0), lenC = can.reduce((s, f) => s + turf.length(f), 0);
  const lay = zClip ? addLayer(`Suvni muhofaza zonasi · ${reg.nomi}`, fcOf([turf.feature(zClip.geometry, { "maydon, km²": +zKm2.toFixed(2), daryo_m: opt.zDaryo, kanal_m: opt.zKanal })]), { derived: true, style: { stroke: "#5BB8FF", fill: "#5BB8FF", fillOpacity: .45, weight: 1 } }) : null;
  addLayer(`Daryo va kanallar · ${reg.nomi}`, fcOf(sv.features.map(f => turf.feature(f.geometry, { nomi: nm(f.properties), turi: f.properties.waterway === "canal" ? "kanal" : "daryo" }))), { derived: true, style: { stroke: "#2D9CDB", fill: "#2D9CDB", weight: 1.6 }, styleFn: f => ({ color: f.properties.turi === "kanal" ? "#2EE6C5" : "#2D9CDB", weight: f.properties.turi === "kanal" ? 1.2 : 2 }) });
  if (hit.length) addLayer(`Zonaga tuşgan qurilişlar · ${reg.nomi}`, fcOf(hit), { derived: true, style: { stroke: "#FF4F8B", fill: "#FF4F8B", fillOpacity: .8 } });
  const SC = ["#2EE6C5", "#F7D154", "#FF4F8B"];
  if (ff.length) addLayer(`Dalalarning suv ta’minoti · ${reg.nomi}`, fcOf(ff), { derived: true, style: { stroke: "#0B2545", fill: "#fff", fillOpacity: .7 }, styleFn: f => ({ fillColor: SC[f.properties._i], fillOpacity: .75, color: "#0B2545", weight: .5 }) });
  const tf = cls.reduce((a, b) => a + b, 0) || 1;
  const html = `<div class="kpis"><div class="kpi"><b class="num">${fmt(lenR, 0)}</b><span>daryo, km</span></div><div class="kpi"><b class="num">${fmt(lenC, 0)}</b><span>kanal, km</span></div><div class="kpi"><b class="num">${fmt(zKm2, 1)}</b><span>muhofaza zonasi, km²</span></div><div class="kpi"><b class="num">${fmt(hitKm2 * 100, 1)}</b><span>zonadagi qurilişlar, ga</span></div></div>
    <p class="small">Zona = daryo bufer ${opt.zDaryo} m ∪ kanal bufer ${opt.zKanal} m, hudud çegarasi bilan kesişmasi (Buffer → Union → Clip). Qurilişlar (turar joy, sanoat) bilan Intersect — zonaga tuşgan qismlar qizil.</p>
    <h3>Dalalarning kanalga yaqinligi (suv taqsimoti)</h3>${ff.length ? sTable(["Kanalgaça", "ga", "%"], [["≤ 0.5 km", cls[0], cls[0] / tf * 100], ["0.5–2 km", cls[1], cls[1] / tf * 100], ["> 2 km", cls[2], cls[2] / tf * 100]]) : `<p class="small muted">OpenStreetMap'da bu hududda ekin maydonlari çizilmagan.</p>`}
    <p class="small" style="color:var(--warn)">Zona kengligini amaldagi qonunçilik va loyiha hujjatlariga qarab kiriting — bu yerda qiymat parametr.</p>
    ${srcNote("OpenStreetMap — waterway=river/canal, landuse=farmland/orchard/vineyard/residential/industrial")}`;
  return { lay, html, csv: ["suv_" + slug(reg.nomi) + ".csv", toCsv(["korsatkich", "qiymat"], [["daryo_km", +lenR.toFixed(1)], ["kanal_km", +lenC.toFixed(1)], ["zona_km2", +zKm2.toFixed(2)], ["zonadagi_qurilish_ga", +(hitKm2 * 100).toFixed(1)], ["dala_0_0.5km_ga", +cls[0].toFixed(1)], ["dala_0.5_2km_ga", +cls[1].toFixed(1)], ["dala_2km_dan_uzoq_ga", +cls[2].toFixed(1)]])] };
}

/* ---------- 5. Ekologiya: zavod + shamol yönalişi → ifloslaniş zonasi ---------- */
async function sohaEko(reg, opt) {
  const bb = turf.bbox(reg.f), G = regGrid(reg), c0 = turf.pointOnFeature(reg.f).geometry.coordinates;
  sLog("OpenStreetMap sanoat obyektlari va Open-Meteo shamol arxivi olinmoqda…");
  const wr = await windRose(c0[0], c0[1]), bb2 = turf.bbox(turf.buffer(reg.f, opt.L, { units: "kilometers" })), [sn, tj, mk] = await osmGet(["sanoat", "turar", "maktab"], bb2);
  const src = sn.features.map(f => { const c = f.geometry.type === "Point" ? f.geometry.coordinates : turf.pointOnFeature(f).geometry.coordinates, a = /Polygon/.test(f.geometry.type) ? turf.area(f) / 1e4 : 1; return { lon: c[0], lat: c[1], w: Math.log10(2 + a), nomi: nm(f.properties), f }; });
  if (!src.length) throw new Error("OpenStreetMap'da bu hudud va uning atrofida sanoat obyekti topilmadi.");
  const ix = new Float32Array(G.n).fill(NaN), sig = 25 * Math.PI / 180;
  // shamol "qayerdan" esadi → tutun teskari tomonga (dir + 180°) ketadi; har rumb uçun yillik takrorlaniş ulushi
  const dirs = wr.f.map((p, i) => ({ p, th: ((i * 45 + 180) % 360) * Math.PI / 180, L: opt.L * (wr.v[i] ? Math.min(2, Math.max(.6, wr.v[i] / 12)) : 1) })).filter(d => d.p > 0);
  let mx = 0;
  for (let k = 0; k < G.n; k++) { if (!G.mask[k]) continue; const lo = G.lon[k % G.W], la = G.lat[Math.floor(k / G.W)], cl = Math.cos(la * Math.PI / 180); let s = 0;
    for (const q of src) { const dx = (lo - q.lon) * 111.3 * cl, dy = (la - q.lat) * 111.3, d = Math.hypot(dx, dy); if (d > opt.L * 3) continue; const az = Math.atan2(dx, dy);
      for (const w of dirs) { let da = Math.abs(az - w.th); if (da > Math.PI) da = 2 * Math.PI - da; s += q.w * w.p * Math.exp(-d / w.L) * Math.exp(-(da * da) / (2 * sig * sig)); }
      if (d < .3) s += q.w * .2; }
    ix[k] = s; if (s > mx) mx = s; }
  for (let k = 0; k < G.n; k++) if (ix[k] >= 0) ix[k] = mx ? Math.min(1, ix[k] / mx) : 0;
  const thr = opt.thr, rm = rasterize(inReg(reg, tj.features.filter(isPoly)), "fill", G);
  let zA = 0, rA = 0, rAll = 0; for (let k = 0; k < G.n; k++) { if (!(ix[k] >= 0)) continue; const a = cellArea(G, k); if (ix[k] >= thr) zA += a; if (rm[k]) { rAll += a; if (ix[k] >= thr) rA += a; } }
  const sch = inReg(reg, mk.features).map(f => { const c = f.geometry.coordinates, k = cellAt(G, c[0], c[1]); return { nomi: nm(f.properties), v: k >= 0 ? ix[k] : 0, c }; }).filter(s => s.v >= thr).sort((a, b) => b.v - a.v);
  const lay = sohaCells(`Ifloslaniş zonasi · ${reg.nomi}`, G, ix, d => d.v < thr ? [46, 120, 90, 120] : [...RISK_C(Math.min(1, (d.v - thr) / (1 - thr) * .7 + .3)), 235], d => ({ title: "Ifloslaniş indeksi " + d.v.toFixed(2), props: { zona: d.v >= thr ? "ta’sir zonasi" : "past" } }), "Sanoat manbalari × yillik shamol takrorlanişi");
  addLayer(`Sanoat obyektlari · ${reg.nomi}`, fcOf(src.map(s => turf.feature(s.f.geometry, { nomi: s.nomi, turi: s.f.properties.landuse || s.f.properties.man_made || s.f.properties.power }))), { derived: true, style: { stroke: "#7A3FB0", fill: "#B07CFF", fillOpacity: .7 }, pointStyle: ptStyle(5) });
  if (sch.length) addLayer(`Zonadagi maktablar · ${reg.nomi}`, fcOf(sch.map(s => turf.point(s.c, { nomi: s.nomi, indeks: +s.v.toFixed(2) }))), { derived: true, style: { stroke: "#0B2545", fill: "#FF4F8B" }, pointStyle: ptStyle(7) });
  const top = wr.f.indexOf(Math.max(...wr.f));
  const rose = `<svg viewBox="-60 -60 120 120" width="140" height="140" style="display:block;margin:4px 0 8px">${[.25, .5].map(r => `<circle r="${r * 100}" fill="none" stroke="rgba(150,180,210,.25)"/>`).join("")}${wr.f.map((p, i) => { const a = (i * 45 - 90) * Math.PI / 180, r = Math.max(3, p / Math.max(...wr.f) * 50), a1 = a - .33, a2 = a + .33; return `<path d="M0 0 L${(r * Math.cos(a1)).toFixed(1)} ${(r * Math.sin(a1)).toFixed(1)} A${r} ${r} 0 0 1 ${(r * Math.cos(a2)).toFixed(1)} ${(r * Math.sin(a2)).toFixed(1)} Z" fill="${i === top ? "#FF4F8B" : "#5BB8FF"}" opacity=".85"/>`; }).join("")}<text y="-52" text-anchor="middle" font-size="11" fill="#E9EEF2">Ş</text></svg>`;
  const html = `<div class="kpis"><div class="kpi"><b class="num">${src.length}</b><span>sanoat obyekti</span></div><div class="kpi"><b class="num">${esc(RUMB[top])}</b><span>ustun shamol (${fmt(wr.f[top] * 100, 0)}% kun)</span></div><div class="kpi"><b class="num">${fmt(zA, 1)}</b><span>ta’sir zonasi, km²</span></div><div class="kpi"><b class="num">${fmt(rAll ? rA / rAll * 100 : 0, 0)}%</b><span>turar joyning zonadagi qismi</span></div></div>
    <div style="display:flex;gap:16px;align-items:center">${rose}<p class="small">Shamol: ${esc(wr.dan)} — ${esc(wr.gacha)}, ${wr.n} kunlik ustun yönaliş (Open-Meteo). Ustun shamol <b>${esc(RUMB[top])}dan</b> esadi, ifloslaniş asosan teskari tomonga tarqaladi. Model: har manbadan har rumb böyiça ekspotensial söniş (L = ${opt.L} km, burçak σ = 25°), takrorlaniş ulushi bilan tortilgan.</p></div>
    <h3>Ta’sir zonasidagi maktablar</h3>${sch.length ? sTable(["Muassasa", "indeks"], sch.slice(0, 12).map(s => [s.nomi, s.v])) : `<p class="small muted">Zonaga maktab tuşmadi.</p>`}
    <p class="small" style="color:var(--warn)">⚠ Bu soddalaştirilgan öquv modeli (Gauss tutun modeli emas): çiqindi hajmi, mörisi balandligi va relyef hisobga olinmagan.</p>
    ${srcNote("OpenStreetMap (landuse=industrial, man_made=works, power=plant, landuse=residential, amenity=school) · Open-Meteo Historical Weather API (ERA5)")}`;
  return { lay, html, csv: ["ekologiya_" + slug(reg.nomi) + ".csv", toCsv(["rumb", "kunlar_ulushi", "ortacha_max_tezlik_kmh"], wr.f.map((p, i) => [RUMB[i], +p.toFixed(3), +wr.v[i].toFixed(1)]))] };
}

/* ---------- 6. Kadastr: yer uçastkalari + çegaralar → yer balansi ---------- */
const YER = { farmland: "Ekin yerlari", orchard: "Bog‘ va tokzorlar", vineyard: "Bog‘ va tokzorlar", plant_nursery: "Bog‘ va tokzorlar", meadow: "Pichanzor va yaylovlar", grass: "Pichanzor va yaylovlar", grassland: "Pichanzor va yaylovlar", scrub: "Pichanzor va yaylovlar", forest: "Ormon fondi", wood: "Ormon fondi", residential: "Aholi punktlari", commercial: "Sanoat, savdo va transport", retail: "Sanoat, savdo va transport", industrial: "Sanoat, savdo va transport", railway: "Sanoat, savdo va transport", quarry: "Sanoat, savdo va transport", water: "Suv fondi", reservoir: "Suv fondi", basin: "Suv fondi", wetland: "Suv fondi", cemetery: "Boşqa yerlar", military: "Boşqa yerlar", landfill: "Boşqa yerlar", sand: "Boşqa yerlar", bare_rock: "Boşqa yerlar", farmyard: "Ekin yerlari", greenhouse_horticulture: "Ekin yerlari" };
async function sohaKadastr(reg, opt) {
  let fs, field, manba;
  if (opt.lay) { const l = LAYERS.find(x => String(x.id) === opt.lay); fs = (l.fc.features || []).filter(isPoly); field = opt.field; manba = "Yuklangan qatlam: " + l.name; }
  else { sLog("OpenStreetMap: yer turlari (landuse) olinmoqda…"); fs = (await osmGet(["yer"], turf.bbox(reg.f)))[0].features.filter(isPoly); manba = "OpenStreetMap — landuse=*, natural=*"; }
  sLog("Çegara bilan kesiş (Clip) va maydonlar hisoblanmoqda…"); await sleep(20);
  const units = reg.tuman ? [reg.f] : TUM.features.filter(f => f.properties.viloyat === reg.vil);
  const cat = f => field ? String(f.properties[field] ?? "—") : (YER[f.properties.landuse] || YER[f.properties.natural] || null);
  const rb = turf.bbox(reg.f), sums = {}, per = units.map(() => ({})), clipped = [];
  let n = 0;
  for (const f of fs) { const c = cat(f); if (!c) continue; const b = turf.bbox(f); if (!bboxHit(b, rb)) continue;
    units.forEach((u, ui) => { if (!bboxHit(b, turf.bbox(u))) return; const x = safe(() => turf.booleanWithin(f, u) ? f : turf.intersect(turf.featureCollection([f, u]))); if (!x) return; const a = turf.area(x) / 1e4; if (!(a > 0)) return;
      sums[c] = (sums[c] || 0) + a; per[ui][c] = (per[ui][c] || 0) + a; if (clipped.length < 6000) clipped.push(turf.feature(x.geometry, { toifa: c, "maydon, ga": +a.toFixed(2), tuman: units.length > 1 ? u.properties.nomi : reg.nomi })); });
    if (++n % 400 === 0) { sLog(`Ishlov berildi: ${n} / ${fs.length}`); await sleep(0); } }
  const totGa = turf.area(reg.f) / 1e4, used = Object.values(sums).reduce((a, b) => a + b, 0), cats = Object.keys(sums).sort((a, b) => sums[b] - sums[a]);
  const COL = ["#E9C46A", "#7ED321", "#A8D5BA", "#2D6A4F", "#FF9F43", "#B07CFF", "#5BB8FF", "#97A9B9", "#FF4F8B", "#2EE6C5"], cc = Object.fromEntries(cats.map((c, i) => [c, COL[i % COL.length]]));
  const lay = addLayer(`Yer balansi · ${reg.nomi}`, fcOf(clipped), { derived: true, style: { stroke: "#0B2545", fill: "#fff", fillOpacity: .7 }, styleFn: f => ({ fillColor: cc[f.properties.toifa], fillOpacity: .78, color: "#0B2545", weight: .4 }) });
  const rows = cats.map(c => [c, sums[c], sums[c] / totGa * 100]); rows.push(["Tasniflanmagan / çizilmagan", Math.max(0, totGa - used), Math.max(0, 100 - used / totGa * 100)]);
  const bar = `<div style="display:flex;height:16px;border-radius:6px;overflow:hidden;margin:6px 0 10px">${cats.map(c => `<i title="${esc(c)}" style="width:${sums[c] / totGa * 100}%;background:${cc[c]}"></i>`).join("")}</div>`;
  const html = `<div class="kpis"><div class="kpi"><b class="num">${fmt(totGa, 0)}</b><span>hudud maydoni, ga</span></div><div class="kpi"><b class="num">${fmt(used / totGa * 100, 0)}%</b><span>tasniflangan qism</span></div><div class="kpi"><b class="num">${clipped.length}</b><span>uçastka/kontur</span></div></div>
    ${bar}${sTable(["Yer toifasi", "ga", "%"], rows)}
    ${units.length > 1 ? `<h3>Tumanlar kesimida, ga</h3>${sTable(["Tuman", ...cats.slice(0, 4)], units.map((u, i) => [u.properties.nomi, ...cats.slice(0, 4).map(c => per[i][c] || 0)]))}` : ""}
    <p class="small">Uçastkalar (poligonlar) ma’muriy çegara bilan Intersect qilinib, har toifa maydoni yiğildi. ${opt.lay ? "" : "OSM konturlari ustma-ust tuşsa (masalan, dala içidagi hövuz), maydon ikki marta sanaladi."}</p>
    <p class="small" style="color:var(--warn)">Rasmiy davlat kadastri oçiq emas. Kadastr Shapefile'ingiz bölsa, “Qatlamlar” orqali yuklab, yuqorida “Manba” dan tanlang — xuddi şu hisob uçastkalaringiz böyiça bajariladi.</p>
    ${srcNote(esc(manba) + " · ma’muriy çegaralar geoBoundaries")}`;
  return { lay, html, csv: ["yer_balansi_" + slug(reg.nomi) + ".csv", toCsv(["toifa", "maydon_ga", "ulush_%"], rows.map(r => [r[0], +r[1].toFixed(1), +r[2].toFixed(2)]))] };
}

/* ---------- UI ---------- */
const SOHALAR = [
  { k: "qishloq", t: "Qişloq xöjaligi", d: "Tuproq, şörlaniş, suv → qaysi dalaga qaysi ekin", run: sohaQishloq, p: () => `<label class="row small"><input type="checkbox" id="sDala" checked> Faqat OSM'dagi ekin maydonlari</label><div class="grid2"><label class="f">Tuproq (GeoTIFF)<select id="sTuproq">${urOpts()}</select></label><label class="f">Şörlaniş (GeoTIFF)<select id="sShor">${urOpts()}</select></label></div>`, opt: () => ({ faqatDala: $("#sDala").checked }) },
  { k: "shahar", t: "Şaharsozlik", d: "Maktab, poliklinika va yöllarga yaqin mahallalar", run: sohaShahar, p: () => `<div class="grid2"><label class="f">Maktab radiusi, m<input type="number" id="sRm" value="500" min="100" step="50"></label><label class="f">Poliklinika, m<input type="number" id="sRk" value="1000" min="100" step="100"></label><label class="f">Yöl, m<input type="number" id="sRy" value="300" min="50" step="50"></label></div>`, opt: () => ({ rMaktab: +$("#sRm").value, rKlinika: +$("#sRk").value, rYol: +$("#sRy").value }) },
  { k: "favq", t: "Favqulodda vaziyatlar", d: "Seysmik zona + sel yöli + maktablar → xavf xaritasi", run: sohaFavq, p: () => `<label class="f">Sel: soy/daryodan masofa, km<input type="number" id="sSel" value="0.5" min="0.1" step="0.1"></label>`, opt: () => ({ selKm: +$("#sSel").value }) },
  { k: "suv", t: "Suv xöjaligi", d: "Daryo böyi muhofaza zonalari, suv taqsimoti", run: sohaSuv, p: () => `<div class="grid2"><label class="f">Daryo zonasi, m<input type="number" id="sZd" value="100" min="10" step="10"></label><label class="f">Kanal zonasi, m<input type="number" id="sZk" value="50" min="10" step="10"></label></div>`, opt: () => ({ zDaryo: +$("#sZd").value, zKanal: +$("#sZk").value }) },
  { k: "eko", t: "Ekologiya", d: "Zavod + şamol yönalişi → ifloslaniş zonasi", run: sohaEko, p: () => `<div class="grid2"><label class="f">Tarqaliş masofasi L, km<input type="number" id="sL" value="3" min="0.5" step="0.5"></label><label class="f">Zona çegarasi (0–1)<input type="number" id="sThr" value="0.25" min="0.05" max="0.9" step="0.05"></label></div>`, opt: () => ({ L: +$("#sL").value, thr: +$("#sThr").value }) },
  { k: "kadastr", t: "Kadastr", d: "Yer uçastkalari + çegaralar → yer balansi", run: sohaKadastr, p: () => { const ls = LAYERS.filter(l => l.kind === "vector" && !l.derived && l.fc && (l.fc.features || []).some(isPoly) && !Object.values(LAY).includes(l)); return `<label class="f">Uçastkalar manbasi<select id="sKl"><option value="">OpenStreetMap (landuse)</option>${ls.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join("")}</select></label><label class="f" id="sKfW" style="display:none">Toifa maydoni<select id="sKf"></select></label>`; }, opt: () => ({ lay: $("#sKl").value || null, field: $("#sKf") ? $("#sKf").value : null }) }
];
const urOpts = () => `<option value="">— yöq —</option>` + USER_RASTERS.map(r => `<option>${esc(r.name)}</option>`).join("");
let SOHA_K = "qishloq";
function sohaUI() {
  $("#sCards").innerHTML = SOHALAR.map(s => `<button type="button" class="scard${s.k === SOHA_K ? " on" : ""}" data-s="${s.k}"><b>${esc(s.t)}</b><span>${esc(s.d)}</span></button>`).join("");
  const s = SOHALAR.find(x => x.k === SOHA_K); $("#sParams").innerHTML = s.p();
  const kl = $("#sKl"); if (kl) { const upd = () => { const l = LAYERS.find(x => String(x.id) === kl.value); $("#sKfW").style.display = l ? "" : "none"; if (l) { const ks = [...new Set(l.fc.features.flatMap(f => Object.keys(f.properties || {})))]; $("#sKf").innerHTML = ks.map(k => `<option>${esc(k)}</option>`).join(""); } }; kl.addEventListener("change", upd); upd(); }
}
$("#sVil").innerHTML = `<option value="">— viloyatni tanlang —</option>` + VILN.slice().sort((a, b) => a.localeCompare(b)).map(v => `<option>${esc(v)}</option>`).join("");
$("#sVil").addEventListener("change", () => { const v = $("#sVil").value; $("#sTum").innerHTML = `<option value="">— tumanni tanlang —</option>` + TUM.features.filter(f => f.properties.viloyat === v).map(f => f.properties.nomi).sort((a, b) => a.localeCompare(b)).map(n => `<option>${esc(n)}</option>`).join(""); const r = sohaRegion(); if (r) fitBBox(turf.bbox(r.f), IS3D ? { pitch: 40 } : {}, 12); });
$("#sTum").addEventListener("change", () => { const r = sohaRegion(); if (r) fitBBox(turf.bbox(r.f), IS3D ? { pitch: 40 } : {}, 13); });
$("#sCards").addEventListener("click", e => { const b = e.target.closest("[data-s]"); if (!b) return; SOHA_K = b.dataset.s; sohaUI(); });
$("#sRun").addEventListener("click", async () => {
  const reg = sohaRegion(); if (!reg) return toast("Avval viloyat yoki tumanni tanlang");
  const s = SOHALAR.find(x => x.k === SOHA_K); if (!reg.tuman) { sLog("Butun viloyat OpenStreetMap uçun juda katta (yuz minglab obyekt, brauzer qotib qoladi). Iltimos, <b>tuman yoki şaharni</b> tanlang."); return toast("Tuman yoki şaharni tanlang"); }
  $("#sRun").disabled = true; await busy(true, s.t + ": maʼlumotlar olinmoqda…");
  if (!CITY || String(CITY).startsWith("soha:")) { CITY = "soha:" + reg.nomi; SLAB = 300; redraw(); } // şahar ustunlarini yaşiriş, yupqa plita
  LAYERS.filter(l => l._soha).forEach(l => removeLayer(l.id)); const uid0 = uid;
  const t0 = performance.now();
  try { const r = await s.run(reg, s.opt()); LAYERS.forEach(l => { if (l.id > uid0) l._soha = true; }); setDrawer(`${s.t} · ${reg.nomi}`, s.d, r.html, r.csv); fitBBox(turf.bbox(reg.f), IS3D ? { pitch: 45, bearing: -15 } : {}, reg.tuman ? 13 : 11); redraw(); sLog(`✓ ${esc(s.t)} — ${reg.nomi}, ${((performance.now() - t0) / 1000).toFixed(1)} s`); RUNS.push({ name: s.t + " · " + reg.nomi, op: "soha", n: 0, area: 0, slivers: 0, ms: performance.now() - t0, rows: [], head: [], time: new Date() }); commit(s.t + ": " + reg.nomi); }
  catch (er) { console.error(er); sLog(`<span style="color:var(--bad)">✕ ${esc(er.message || er)}</span>`); }
  await busy(false); $("#sRun").disabled = false;
});
sohaUI();
