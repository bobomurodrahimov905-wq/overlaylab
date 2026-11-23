/* OverlayLab — Supabase ulagiçi.
   Platforma kodi window.claude.use("db"/"user") interfeysi orqali işlaydi;
   bu fayl o'şa interfeysni Supabase'dagi "docs" jadvali ustiga quradi:
   har bir hujjat = bitta qator (path, coll, data jsonb). */
(function () {
  const CFG = window.OVERLAYLAB_CONFIG || {};
  const ok = CFG.url && CFG.anonKey && !/SIZNING|YOUR/.test(CFG.url + CFG.anonKey) && window.supabase;
  if (!ok) { window.claude = { use: async () => null }; console.info("OverlayLab: Supabase sozlanmagan — oflayn rejim"); return; }
  const sb = window.supabase.createClient(CFG.url, CFG.anonKey);
  window.__sb = sb;
  const cache = new Map(); let loaded = false; const subs = new Set();
  const parent = p => p.split("/").slice(0, -1).join("/");
  const fire = () => subs.forEach(f => { try { f(); } catch (e) { console.error(e); } });
  async function loadAll() {
    const { data, error } = await sb.from("docs").select("path,data").limit(10000);
    if (error) { console.warn("Baza:", error.message); return; }
    cache.clear(); data.forEach(r => cache.set(r.path, r.data)); loaded = true; fire();
  }
  sb.channel("docs-live").on("postgres_changes", { event: "*", schema: "public", table: "docs" }, p => {
    if (p.eventType === "DELETE") cache.delete(p.old.path); else cache.set(p.new.path, p.new.data); fire();
  }).subscribe();
  loadAll(); setInterval(loadAll, 60000); // realtime yoqilmagan bölsa ham daqiqasiga yangilanadi
  const meta = { fromCache: false, hasPendingWrites: false };
  const snap = p => ({ id: p.split("/").pop(), exists: cache.has(p), data: () => cache.get(p), metadata: meta });
  const deep = (a, b) => { const o = { ...(a || {}) }; for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === "object" && !Array.isArray(v) && o[k] && typeof o[k] === "object" ? deep(o[k], v) : v; return o; };
  async function write(p, d) {
    const { data: u } = await sb.auth.getUser();
    const { error } = await sb.from("docs").upsert({ path: p, coll: parent(p), data: d, updated_at: new Date().toISOString(), updated_by: u.user ? u.user.email : null });
    if (error) throw { code: /row-level|permission|42501/.test(error.message + error.code) ? "invalid_argument" : "unavailable", message: error.message };
    cache.set(p, d); fire();
  }
  const docRef = p => ({ id: p.split("/").pop(), path: p,
    get: async () => snap(p),
    set: d => write(p, d),
    update: async d => { if (!cache.has(p)) throw { code: "invalid_argument", message: "hujjat yöq" }; return write(p, deep(cache.get(p), d)); },
    delete: async () => { const { error } = await sb.from("docs").delete().eq("path", p); if (error) throw { code: "invalid_argument", message: error.message }; cache.delete(p); fire(); },
    onSnapshot(next) { const run = () => loaded && next(snap(p)); subs.add(run); run(); return () => subs.delete(run); },
    collection: c => coll(p + "/" + c) });
  const coll = (c, ord, lim) => ({ path: c,
    doc: id => docRef(c + "/" + (id || Date.now().toString(36) + Math.random().toString(36).slice(2, 8))),
    add: async d => { const r = docRef(c + "/" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)); await r.set(d); return r; },
    orderBy: (f, dir) => coll(c, [f, dir || "asc"], lim), limit: n => coll(c, ord, n), where: () => coll(c, ord, lim),
    get: async () => { let ds = [...cache.keys()].filter(k => parent(k) === c).map(snap); return { docs: ds, size: ds.length, empty: !ds.length, metadata: meta }; },
    onSnapshot(next) {
      const run = () => { if (!loaded) return; let ds = [...cache.keys()].filter(k => parent(k) === c).map(snap);
        if (ord) ds.sort((a, b) => ((a.data()[ord[0]] ?? 0) > (b.data()[ord[0]] ?? 0) ? 1 : -1) * (ord[1] === "desc" ? -1 : 1));
        if (lim) ds = ds.slice(0, lim); next({ docs: ds, size: ds.length, empty: !ds.length, metadata: meta, docChanges: () => [] }); };
      subs.add(run); run(); return () => subs.delete(run); } });
  const db = { doc: docRef, collection: c => coll(c) };
  const user = {
    id: async () => { const { data } = await sb.auth.getUser(); return data.user ? data.user.email : null; },
    can: async () => { const { data } = await sb.auth.getUser(); if (!data.user) return false; const r = await sb.rpc("is_admin"); return !!r.data; },
    canEdit: async () => user.can(), isOwner: async () => user.can(),
    profiles: async ids => Object.fromEntries(ids.map(i => [i, { name: String(i || "").split("@")[0] }]))
  };
  window.claude = { use: async n => n === "db" ? db : n === "user" ? user : null };

  // Admin kiriş paneli (Baza bölimida)
  document.addEventListener("DOMContentLoaded", () => {
    const host = document.getElementById("bazaBody"); if (!host) return;
    const box = document.createElement("div"); box.className = "authbox";
    box.innerHTML = `<div id="authOut"><p class="small muted">Ma’lumotlarni faqat administrator özgartiradi.</p><div class="row2"><input id="aEmail" type="email" placeholder="Email" autocomplete="username"><input id="aPass" type="password" placeholder="Parol" autocomplete="current-password"></div><button class="btn" id="aIn" type="button">Administrator sifatida kiriş</button></div><div id="authIn" style="display:none"><p class="small">Kirdingiz: <b id="aWho"></b></p><button class="btn ghost" id="aOut" type="button">Çiqiş</button></div>`;
    host.insertBefore(box, host.children[3] || null);
    const upd = async () => { const { data } = await sb.auth.getUser(); const u = data.user; box.querySelector("#authOut").style.display = u ? "none" : ""; box.querySelector("#authIn").style.display = u ? "" : "none"; if (u) box.querySelector("#aWho").textContent = u.email; window.bazaAuth && window.bazaAuth(); };
    box.querySelector("#aIn").onclick = async () => { const { error } = await sb.auth.signInWithPassword({ email: box.querySelector("#aEmail").value.trim(), password: box.querySelector("#aPass").value }); if (error) alertMsg("Kiriş xatosi: " + error.message); else { box.querySelector("#aPass").value = ""; upd(); } };
    box.querySelector("#aOut").onclick = async () => { await sb.auth.signOut(); upd(); };
    const alertMsg = m => { const t = document.getElementById("toast"); if (t) { t.textContent = m; t.classList.add("on"); setTimeout(() => t.classList.remove("on"), 3500); } };
    sb.auth.onAuthStateChange(() => setTimeout(upd, 0)); upd();
  });
})();
