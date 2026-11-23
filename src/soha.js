
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
    // 1) asosiy manba — OpenFreeMap vektor plitkalari (tez, keşlanadi)
    try {
      const t0 = Date.now(), layers = [...new Set(need.flatMap(k => VT_LAYERS[k] || []))];
      const rp = SOHA.poly && turf.bbox(SOHA.poly).every((v, i) => Math.abs(v - bb[i]) < 1e-9) ? SOHA.poly : null;
      const fc = await vtFeatures(bb, layers, { poly: rp, onProgress: (d, n) => sLog(`OpenStreetMap: xarita plitkalari ${d}/${n} (${Math.round((Date.now() - t0) / 1000)} s)…`) });
      need.forEach(k => { SOHA.cache[ck(k)] = { type: "FeatureCollection", features: fc.features.filter(f => (VT_LAYERS[k] || []).length && OSMT[k](f.properties || {})).map(f => OSMQ[k][1] === "center" && f.geometry.type !== "Point" ? turf.feature(turf.pointOnFeature(f).geometry, f.properties) : f) }; });
      sLog(`OpenStreetMap: ${fc.features.length} obyekt, ${fc.tiles} plitka (${((Date.now() - t0) / 1000).toFixed(1)} s). Hisoblanmoqda…`); await sleep(20);
      return keys.map(k => SOHA.cache[ck(k)]);
    } catch (e) { console.warn("Vektor plitkalar:", e); sLog("Xarita plitkalari olinmadi, Overpass serveriga ötilmoqda…"); }
    // 2) zaxira — Overpass API
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
  // faqat hudud atrofidagi (±1.5°) zilzilalar — butun mintaqa 9 MB, bu esa ~0.5 MB
  const B = [Math.max(54, bb[0] - 1.5), Math.max(34, bb[1] - 1.5), Math.min(77, bb[2] + 1.5), Math.min(48, bb[3] + 1.5)].map(v => +v.toFixed(1)), k = "usgs|" + B.join(",");
  if (SOHA.cache[k]) return SOHA.cache[k];
  const c = await idbGet("kv", k); if (c && Date.now() - c.t < 30 * 864e5) return (SOHA.cache[k] = c.j);
  const u = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=1960-01-01&minmagnitude=4&minlatitude=${B[1]}&maxlatitude=${B[3]}&minlongitude=${B[0]}&maxlongitude=${B[2]}&orderby=magnitude&limit=20000`;
  let r; try { r = await fetchT(u, 60000); } catch (e) { if (c) return (SOHA.cache[k] = c.j); throw new Error("USGS zilzila katalogi 60 s ichida javob bermadi"); }
  if (!r.ok) { if (c) return (SOHA.cache[k] = c.j); throw new Error("USGS zilzila katalogi javob bermadi (HTTP " + r.status + ")"); }
  const j0 = await r.json(), j = { type: "FeatureCollection", features: (j0.features || []).map(f => ({ type: "Feature", geometry: f.geometry, properties: { mag: f.properties.mag, place: f.properties.place, time: f.properties.time } })) };
  SOHA.cache[k] = j; idbPut("kv", k, { j, t: Date.now() }); return j;
}
async function windRose(lon, lat) {
  const k = "wind|" + lon.toFixed(1) + "," + lat.toFixed(1); if (SOHA.cache[k]) return SOHA.cache[k];
  { const c = await idbGet("kv", k); if (c && Date.now() - c.t < 30 * 864e5) return (SOHA.cache[k] = c.j); }
  const e = new Date(Date.now() - 6 * 864e5), s = new Date(e.getTime() - 365 * 864e5), d = x => x.toISOString().slice(0, 10);
  const u = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&start_date=${d(s)}&end_date=${d(e)}&daily=wind_direction_10m_dominant,wind_speed_10m_max&timezone=Asia%2FTashkent`;
  const r = await fetch(u, { signal: AbortSignal.timeout(40000) }).catch(e => { throw new Error("Open-Meteo 40 s ichida javob bermadi"); }); if (!r.ok) throw new Error("Open-Meteo shamol arxivi javob bermadi (HTTP " + r.status + ")");
  const j = await r.json(), dir = j.daily.wind_direction_10m_dominant, sp = j.daily.wind_speed_10m_max;
  const f = new Array(8).fill(0), v = new Array(8).fill(0); let n = 0;
  dir.forEach((a, i) => { if (a == null) return; const sct = Math.round(a / 45) % 8; f[sct]++; v[sct] += sp[i] || 0; n++; });
  const out = { f: f.map(x => x / Math.max(1, n)), v: v.map((x, i) => f[i] ? x / f[i] : 0), n, dan: d(s), gacha: d(e) }; SOHA.cache[k] = out; idbPut("kv", k, { j: out, t: Date.now() }); return out;
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
  // har bir mahalla bali: faqat uning bbox'idagi kataklar tekshiriladi (butun hududni qayta çizmasdan — ~10x tez)
  const per = res.slice(0, 3000).map(f => { let a = 0, n = 0; const b = turf.bbox(f);
    const [xa, ya] = merc(b[0], b[3]), [xb, yb] = merc(b[2], b[1]);
    const j0 = Math.max(0, Math.floor((xa - G.x0) / G.cs)), j1 = Math.min(G.W - 1, Math.floor((xb - G.x0) / G.cs)), i0 = Math.max(0, Math.floor((G.y0 - ya) / G.cs)), i1 = Math.min(G.H - 1, Math.floor((G.y0 - yb) / G.cs));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = i * G.W + j; if (sc[k] >= 0 && safe(() => turf.booleanPointInPolygon([G.lon[j], G.lat[i]], f))) { a += sc[k]; n++; } }
    if (!n) { const c = safe(() => turf.pointOnFeature(f).geometry.coordinates), k = c ? cellAt(G, c[0], c[1]) : -1; if (k >= 0 && sc[k] >= 0) { a = sc[k]; n = 1; } }
    return { nomi: nm(f.properties), s: n ? a / n : null, ga: turf.area(f) / 1e4 }; }).filter(r => r.s != null).sort((a, b) => a.s - b.s);
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
  SOHA.poly = reg.f;
  $("#sRun").disabled = true; await busy(true, s.t + ": maʼlumotlar olinmoqda…");
  if (!CITY || String(CITY).startsWith("soha:")) { CITY = "soha:" + reg.nomi; SLAB = 300; redraw(); } // şahar ustunlarini yaşiriş, yupqa plita
  LAYERS.filter(l => l._soha).forEach(l => removeLayer(l.id)); const uid0 = uid;
  const t0 = performance.now();
  try { const r = await s.run(reg, s.opt()); LAYERS.forEach(l => { if (l.id > uid0) l._soha = true; }); setDrawer(`${s.t} · ${reg.nomi}`, s.d, r.html, r.csv); fitBBox(turf.bbox(reg.f), IS3D ? { pitch: 45, bearing: -15 } : {}, reg.tuman ? 13 : 11); redraw(); sLog(`✓ ${esc(s.t)} — ${reg.nomi}, ${((performance.now() - t0) / 1000).toFixed(1)} s`); RUNS.push({ name: s.t + " · " + reg.nomi, op: "soha", n: 0, area: 0, slivers: 0, ms: performance.now() - t0, rows: [], head: [], time: new Date() }); commit(s.t + ": " + reg.nomi); }
  catch (er) { console.error(er); sLog(`<span style="color:var(--bad)">✕ ${esc(er.message || er)}</span>`); }
  await busy(false); $("#sRun").disabled = false;
});
sohaUI();
