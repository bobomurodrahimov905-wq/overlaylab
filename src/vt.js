
/* =====================================================================
   VEKTOR PLITKALAR — OpenStreetMap ma'lumotining tezkor va işonçli manbasi
   • OpenFreeMap (OpenMapTiles sxemasi) plitkalari CDN orqali keladi: kalitsiz,
     CORS oçiq, Overpass serverlari kabi navbat va 504 xatolari yöq.
   • Har bir plitka brauzerda (IndexedDB) 14 kun saqlanadi — ikkinçi marta
     oçilganda ma'lumot internetsiz, bir zumda olinadi.
   • Plitka xususiyatlari OSM teglariga (amenity, highway, landuse, ...)
     ötkaziladi, şuning uçun tahlil kodi özgarişsiz işlaydi.
   ===================================================================== */
const { MVTLayer } = deck;
const VT = { url: null, z: 14, maxTiles: 900, mem: new Map(), db: null };
const VT_FALLBACK = "https://tiles.openfreemap.org/planet/20261115_080022_pt/{z}/{x}/{y}.pbf";
const VT_TTL = 14 * 864e5;
const fetchT = async (u, ms = 30000, init = {}) => { const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms); try { return await fetch(u, { ...init, signal: ac.signal }); } catch (e) { throw e.name === "AbortError" ? new Error(new URL(u).host + " " + Math.round(ms / 1000) + " s ichida javob bermadi") : e; } finally { clearTimeout(t); } };

// MVT o'quvçi ESM modul sifatida yuklanadi — deck.gl'ning global "loaders" registriga tegmaydi
let MVT_P = null;
const mvtLoader = () => MVT_P || (MVT_P = import("https://cdn.jsdelivr.net/npm/@loaders.gl/mvt@4.2.2/+esm").then(m => m.MVTLoader).catch(e => { MVT_P = null; throw new Error("Vektor plitka kutubxonasi yuklanmadi: " + e.message); }));
/* ---------- IndexedDB kesh (xato bölsa jimgina xotirada işlaydi) ---------- */
function vtDB() {
  if (VT.db !== null) return VT.db;
  VT.db = new Promise(res => { try { const r = indexedDB.open("overlaylab", 2); r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains("t")) d.createObjectStore("t"); if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv"); }; r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null); } catch (e) { res(null); } });
  return VT.db;
}
async function idbGet(store, k) { const d = await vtDB(); if (!d) return null; return new Promise(res => { try { const q = d.transaction(store).objectStore(store).get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch (e) { res(null); } }); }
async function idbPut(store, k, v) { const d = await vtDB(); if (!d) return; try { d.transaction(store, "readwrite").objectStore(store).put(v, k); } catch (e) { /* kvota tugagan bölişi mumkin */ } }

async function vtTemplate() {
  if (VT.url) return VT.url;
  const c = await idbGet("kv", "vturl"); if (c && Date.now() - c.t < 864e5) return (VT.url = c.u);
  try { const j = await (await fetchT("https://tiles.openfreemap.org/planet", 12000)).json(); VT.url = j.tiles[0]; idbPut("kv", "vturl", { u: VT.url, t: Date.now() }); }
  catch (e) { VT.url = (c && c.u) || VT_FALLBACK; }
  return VT.url;
}
const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };
const x2lon = (x, z) => x / 2 ** z * 360 - 180;
const y2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(.5 * (Math.exp(n) - Math.exp(-n))); };
function vtTiles(bb, z, poly) {
  const x0 = lon2x(bb[0], z), x1 = lon2x(bb[2], z), y0 = lat2y(bb[3], z), y1 = lat2y(bb[1], z), out = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    if (poly) { const tb = turf.bboxPolygon([x2lon(x, z), y2lat(y + 1, z), x2lon(x + 1, z), y2lat(y, z)]); if (!safe(() => turf.booleanIntersects(tb, poly))) continue; }
    out.push([x, y]);
  }
  return out;
}
async function vtTile(z, x, y) {
  const k = `${z}/${x}/${y}`; if (VT.mem.has(k)) return VT.mem.get(k);
  const c = await idbGet("t", k); if (c && Date.now() - c.t < VT_TTL) { VT.mem.set(k, c.b); return c.b; }
  const u = (await vtTemplate()).replace("{z}", z).replace("{x}", x).replace("{y}", y);
  let err;
  for (let a = 0; a < 3; a++) {
    try { const r = await fetchT(u, 25000); if (r.status === 204 || r.status === 404) { VT.mem.set(k, null); return null; } if (!r.ok) throw new Error("HTTP " + r.status);
      const b = await r.arrayBuffer(); VT.mem.set(k, b); idbPut("t", k, { b, t: Date.now() }); return b; }
    catch (e) { err = e; await sleep(400 * (a + 1)); }
  }
  if (c) { VT.mem.set(k, c.b); return c.b; } // eskirgan kesh — yöqdan yaxşi
  throw err;
}

/* ---------- OpenMapTiles → OSM teglari ---------- */
const VT_POI = { school: s => s === "kindergarten" ? { amenity: "kindergarten" } : { amenity: "school" }, hospital: s => ({ amenity: s === "clinic" ? "clinic" : "hospital" }), doctors: () => ({ amenity: "doctors" }), dentist: () => ({ amenity: "dentist" }), pharmacy: () => ({ amenity: "pharmacy" }), college: s => ({ amenity: s === "university" ? "university" : "college" }), bus: () => ({ highway: "bus_stop" }), railway: s => s === "subway" ? { public_transport: "platform", railway: "station" } : { railway: "station" }, entrance: s => s === "subway_entrance" ? { public_transport: "platform" } : {}, fuel: () => ({ amenity: "fuel" }), police: () => ({ amenity: "police" }), fire_station: () => ({ amenity: "fire_station" }), place_of_worship: () => ({ amenity: "place_of_worship" }) };
const VT_ROAD = { motorway: "motorway", trunk: "trunk", primary: "primary", secondary: "secondary", tertiary: "tertiary", minor: "residential", service: "service", track: "track", busway: "service", raceway: "service" };
function vtTags(p) {
  const L = p.layerName, c = String(p.class || ""), s = String(p.subclass || ""), t = {};
  const nm0 = p["name:latin"] || p.name || p.name_int || p.name_en; if (nm0) t.name = nm0; if (p["name:ru"]) t["name:ru"] = p["name:ru"]; if (p["name:uz"]) t["name:uz"] = p["name:uz"];
  if (L === "poi") Object.assign(t, (VT_POI[c] || (() => ({ amenity: s || c })))(s), { _poi: c + (s ? "/" + s : "") });
  else if (L === "transportation" || L === "transportation_name") {
    const base = c.replace(/_construction$/, "");
    if (base === "rail" || base === "transit") { if (base === "rail" && (!s || s === "rail" || s === "narrow_gauge")) t.railway = "rail"; else t.railway = s || base; }
    else if (base === "path") t.highway = s || "footway";
    else if (VT_ROAD[base]) t.highway = VT_ROAD[base] + (p.ramp ? "_link" : "");
    if (/_construction$/.test(c)) t.construction = "yes"; if (p.brunnel) t[p.brunnel] = "yes"; if (p.ref) t.ref = p.ref;
  }
  else if (L === "landuse") t.landuse = c;
  else if (L === "landcover") { if (c === "farmland") t.landuse = /^(orchard|vineyard)$/.test(s) ? s : "farmland"; else if (c === "wood") t.natural = "wood"; else if (c === "grass") t.natural = s === "scrub" ? "scrub" : "grassland"; else if (c === "sand") t.natural = "sand"; else if (c === "wetland") t.natural = "wetland"; else if (c === "rock") t.natural = "bare_rock"; else t.natural = c; }
  else if (L === "water") t.natural = "water";
  else if (L === "waterway") t.waterway = c;
  else if (L === "building") { t.building = "yes"; if (p.render_height) t.height = String(p.render_height); }
  else if (L === "park") t.leisure = "park";
  else if (L === "housenumber") t["addr:housenumber"] = p.housenumber;
  return t;
}
const VT_LAYERS = { maktab: ["poi"], tibbiyot: ["poi"], yol: ["transportation"], yolKatta: ["transportation"], turar: ["landuse"], suv: ["waterway"], suvMayda: ["waterway"], ekin: ["landcover"], sanoat: ["landuse", "poi"], yer: ["landuse", "landcover", "water", "park"] };

/* bb (yoki poly) qamrab olgan plitkalardan berilgan qatlamlarni oladi */
async function vtFeatures(bb, layers, opt = {}) {
  let z = opt.z || VT.z, tiles = vtTiles(bb, z, opt.poly);
  while (tiles.length > VT.maxTiles && z > 12) { z--; tiles = vtTiles(bb, z, opt.poly); }
  const MVT = await mvtLoader();
  const out = [], seen = new Set(); let done = 0, failed = 0, i = 0;
  const work = async () => {
    while (i < tiles.length) {
      const [x, y] = tiles[i++];
      try { const b = await vtTile(z, x, y);
        if (b) { const fc = MVT.parseSync(b.slice(0), { mvt: { coordinates: "wgs84", tileIndex: { x, y, z }, shape: "geojson", layers, layerProperty: "layerName" } });
          for (const f of (Array.isArray(fc) ? fc : fc.features || [])) {
            if (!f.geometry) continue; const tags = vtTags(f.properties || {});
            if (f.geometry.type === "Point") { const k = (tags.name || "") + "|" + (tags.amenity || tags.highway || tags.railway || "") + "|" + f.geometry.coordinates.map(v => v.toFixed(5)).join(","); if (seen.has(k)) continue; seen.add(k); }
            out.push({ type: "Feature", geometry: f.geometry, properties: tags });
          } } }
      catch (e) { failed++; console.warn("plitka", z, x, y, e.message); }
      done++; if (opt.onProgress && (done % 4 === 0 || done === tiles.length)) opt.onProgress(done, tiles.length);
      if (done % 6 === 0) await sleep(0);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, tiles.length) }, work));
  if (tiles.length && failed === tiles.length) throw new Error("Xarita plitkalari yuklanmadi (internet aloqasini tekşiring)");
  return { type: "FeatureCollection", features: out, z, tiles: tiles.length, failed };
}

/* ---------- manzil: Nominatim → Photon (zaxira) ---------- */
async function geoReverse(lat, lon) {
  try { const r = await fetchT(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&accept-language=uz,ru`, 10000); if (r.ok) { const j = await r.json(); if (j && j.address) return j; } } catch (e) { }
  try { const r = await fetchT(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&limit=1`, 10000); const j = await r.json(), p = (j.features && j.features[0] || {}).properties; if (p) return { name: p.name, address: { road: p.street, house_number: p.housenumber, neighbourhood: p.locality, city_district: p.district, city: p.city, state: p.state } }; } catch (e) { }
  return null;
}
async function geoSearch(q) {
  // xarita markaziga tortiliş faqat şahar darajasida (zum ≥ 11); joy nomlari va köçalar dökon/kafedan oldin
  const bias = VS.zoom >= 11 ? `&lat=${VS.latitude.toFixed(4)}&lon=${VS.longitude.toFixed(4)}&location_bias_scale=0.3` : "";
  const RANK = { place: 0, boundary: 0, highway: 1, tourism: 1, historic: 1, leisure: 2, building: 2, landuse: 2, railway: 2, amenity: 3, office: 4, shop: 5, craft: 5 };
  try { const r = await fetchT(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=15${bias}&bbox=55.9,37.1,73.2,45.6`, 10000); const j = await r.json();
    const seen = new Set();
    const fs = (j.features || []).map((f, i) => ({ f, i, r: (RANK[(f.properties || {}).osm_key] ?? 3) + (/^(city|town|village|suburb|neighbourhood|square|quarter)$/.test((f.properties || {}).osm_value) ? -1 : 0) })).sort((a, b) => a.r - b.r || a.i - b.i).map(o => o.f)
      .filter(f => { const p = f.properties || {}; if (p.countrycode && p.countrycode !== "UZ") return false; const k = (p.name || "") + "|" + (p.city || p.county || "") + "|" + (p.osm_value || ""); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8)
      .map(f => { const p = f.properties || {}; return { lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], nomi: p.name || [p.street, p.housenumber].filter(Boolean).join(" ") || q, izoh: [p.street && p.name ? p.street + (p.housenumber ? " " + p.housenumber : "") : "", p.locality, p.district, p.city || p.county, p.state].filter(Boolean).join(", "), ext: p.extent }; });
    if (fs.length) return fs; } catch (e) { }
  try { const r = await fetchT(`https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&countrycodes=uz&limit=8&accept-language=uz,ru`, 10000); const j = await r.json();
    return j.map(x => ({ lon: +x.lon, lat: +x.lat, nomi: x.name || x.display_name.split(",")[0], izoh: x.display_name.split(",").slice(1, 4).join(","), ext: x.boundingbox ? [+x.boundingbox[2], +x.boundingbox[1], +x.boundingbox[3], +x.boundingbox[0]] : null })); } catch (e) { }
  return [];
}
