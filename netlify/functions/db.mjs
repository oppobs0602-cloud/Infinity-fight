import { getStore } from "@netlify/blobs";

const ID = /^[A-Za-z0-9_-]{8,64}$/;
const COLS = {
  lb: { order: ["wave"] },
  rank: { order: ["rp"] },
  saves: { order: [] },
};
const MAX_ROWS = 300;
const cache = new Map();

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const int = (v, lo, hi) => {
  v = Math.floor(Number(v));
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
};

function clean(col, d) {
  if (!d || typeof d !== "object") return null;
  const name = String(d.name ?? "ผู้เล่น").slice(0, 16);
  if (col === "lb") return { name, wave: int(d.wave, 0, 9999), lv: int(d.lv, 0, 999), t: Date.now() };
  if (col === "rank") {
    const def = d.def;
    if (def !== undefined && (!Array.isArray(def) || JSON.stringify(def).length > 20000)) return null;
    return { name, rp: int(d.rp, 0, 99999), def: def || [], t: Date.now() };
  }
  if (col === "saves") {
    const s = String(d.s ?? "");
    return s.length > 400000 ? null : { s };
  }
  return null;
}

export default async (req) => {
  try {
    if (req.method === "PUT") {
      const b = await req.json();
      if (!COLS[b.col] || !ID.test(b.id || "")) return json({ error: "bad request" }, 400);
      const data = clean(b.col, b.data);
      if (!data) return json({ error: "bad data" }, 400);
      const store = getStore({ name: "game-" + b.col, consistency: "strong" });
      await store.setJSON(b.id, data);
      cache.delete(b.col);
      return json({ ok: true });
    }

    if (req.method !== "GET") return json({ error: "method" }, 405);
    const u = new URL(req.url);
    const col = u.searchParams.get("col");
    if (!COLS[col]) return json({ error: "bad request" }, 400);
    const store = getStore({ name: "game-" + col, consistency: "strong" });

    const id = u.searchParams.get("id");
    if (id) {
      if (!ID.test(id)) return json({ error: "bad id" }, 400);
      const data = await store.get(id, { type: "json" });
      return json(data ? { exists: true, data } : { exists: false });
    }

    const order = u.searchParams.get("order");
    if (!COLS[col].order.includes(order)) return json({ error: "bad order" }, 400);
    const limit = int(u.searchParams.get("limit") || 50, 1, 100);

    let c = cache.get(col);
    if (!c || Date.now() - c.t > 5000) {
      const { blobs } = await store.list();
      const rows = (
        await Promise.all(
          blobs.slice(0, MAX_ROWS).map(async (x) => {
            const d = await store.get(x.key, { type: "json" });
            return d ? { id: x.key, ...d } : null;
          })
        )
      ).filter(Boolean);
      c = { t: Date.now(), rows };
      cache.set(col, c);
    }
    const docs = [...c.rows].sort((a, b) => (b[order] ?? 0) - (a[order] ?? 0)).slice(0, limit);
    return json({ docs });
  } catch (e) {
    return json({ error: "server" }, 500);
  }
};

export const config = { path: "/api/db" };
