// Balager visit counter: a Cloudflare Worker with one KV namespace bound as COUNTER.
// GET /            -> {"visits": n}                  read only (site footer)
// GET /hit         -> counts a visit (one per browser session) and its country
// GET /hit?new=1   -> the same, and also counts a new unique visitor (first visit ever on that browser)
// GET /hit?src=X   -> also tallies where the visit came from (Telegram, WhatsApp, Facebook, Google...)
// GET /apps        -> today's money-app rates to Ethiopia (Taptap Send for now), cached for an hour
// GET /stats       -> page: visits and unique visitors by source and country. No IP addresses are stored.
const ORIGINS = ["https://balagerhub.com", "https://www.balagerhub.com", "http://balagerhub.com"];

// Taptap Send publishes its rates for its own website calculator; browsers on other sites can't read it, so we fetch it here.
async function appRates(env) {
  const cache = caches.default, key = new Request("https://balager-cache/apps-v1");
  const hit = await cache.match(key);
  if (hit) return hit.json();
  let out = null;
  try {
    const r = await fetch("https://api.taptapsend.com/api/fxRates", {
      headers: { "Appian-Version": "web/2022-05-03.0", "X-Device-Id": "web", "X-Device-Model": "web" },
    });
    if (r.ok) {
      const j = await r.json(), taptap = {};
      for (const o of j.availableCountries || [])
        for (const k of o.corridors || [])
          if (k.currency === "ETB" && +k.fxRate > 0)
            taptap[o.isoCountryCode] = { cur: o.currency, rate: +k.fxRate, fee: +(k.senderCurrencyFlatFee || 0) };
      if (taptap.US) out = { at: new Date().toISOString(), taptap };
    }
  } catch (e) {}
  if (out) { try { await env.COUNTER.put("apps", JSON.stringify(out)); } catch (e) {} }
  else { try { out = JSON.parse((await env.COUNTER.get("apps")) || "null"); } catch (e) {} }
  out = out || { at: null, taptap: {} };
  await cache.put(key, new Response(JSON.stringify(out), { headers: { "Cache-Control": "max-age=3600" } }));
  return out;
}

async function load(env) {
  let d = null;
  try { d = JSON.parse((await env.COUNTER.get("stats")) || "null"); } catch (e) {}
  if (!d) {
    const old = parseInt((await env.COUNTER.get("visits")) || "0", 10);
    d = { visits: old, countries: {}, since: new Date().toISOString().slice(0, 10) };
  }
  // upgrade older format {CC: n} -> {CC: {v, u}}
  for (const [c, x] of Object.entries(d.countries)) if (typeof x === "number") d.countries[c] = { v: x, u: 0 };
  if (!d.sources) d.sources = {};
  if (d.uniques == null) { d.uniques = 0; d.uniquesSince = new Date().toISOString().slice(0, 10); }
  return d;
}

function countryName(code) {
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code; } catch (e) { return code; }
}

function srcTable(d) {
  const fmt = n => n.toLocaleString("en-US");
  const rows = Object.entries(d.sources || {}).sort((a, b) => b[1].v - a[1].v);
  if (!rows.length) return "";
  const tot = rows.reduce((a, b) => a + b[1].v, 0);
  return `<h2 style="font-size:18px;margin:26px 0 10px">Where visitors came from</h2><table><thead><tr><th>Source</th><th class="n">Visits</th><th class="n">Unique</th><th class="n">Share</th><th></th></tr></thead><tbody>` +
    rows.map(([s, x]) => { const pct = ((x.v / tot) * 100).toFixed(1); return `<tr><td>${s.replace(/[<>&"]/g, "")}</td><td class="n">${fmt(x.v)}</td><td class="n">${fmt(x.u)}</td><td class="n">${pct}%</td><td><i style="width:${pct}%"></i></td></tr>`; }).join("") +
    `</tbody></table>`;
}

function statsPage(d) {
  const fmt = n => n.toLocaleString("en-US");
  const counted = Object.values(d.countries).reduce((a, b) => a + b.v, 0);
  const rows = Object.entries(d.countries).sort((a, b) => b[1].v - a[1].v);
  if (d.visits > counted) rows.push(["--", { v: d.visits - counted, u: 0 }]);
  const tr = rows.map(([c, x]) => {
    const name = c === "--" ? "Before country tracking" : c === "XX" || c === "T1" ? "Unknown" : countryName(c);
    const pct = d.visits ? ((x.v / d.visits) * 100).toFixed(1) : "0";
    return `<tr><td>${name}</td><td class="n">${fmt(x.v)}</td><td class="n">${c === "--" ? "–" : fmt(x.u)}</td><td class="n">${pct}%</td><td><i style="width:${pct}%"></i></td></tr>`;
  }).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Balager visits</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:24px 16px;background:#0b0f0c;color:#f2f1ec}main{max-width:760px;margin:auto}.k{display:flex;gap:12px;flex-wrap:wrap;margin:0 0 8px}.k div{background:#121813;border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:14px 18px;min-width:150px}.k b{display:block;font-size:32px}.k span{color:#a9b2aa;font-size:13px}p{color:#a9b2aa;margin:8px 0 20px;font-size:14px}table{width:100%;border-collapse:collapse;background:#121813;border-radius:12px;overflow:hidden}td,th{padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08);text-align:left}th{font-size:13px;color:#a9b2aa;font-weight:500}.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}td:last-child{width:24%}i{display:block;height:8px;border-radius:4px;background:#f5c542}</style></head>
<body><main><div class="k"><div><b>${fmt(d.visits)}</b><span>visits</span></div><div><b>${fmt(d.uniques)}</b><span>unique visitors since ${d.uniquesSince}</span></div><div><b>${Object.keys(d.countries).filter(c => c !== "XX" && c !== "T1").length}</b><span>countries</span></div></div>
<p>balagerhub.com · a visit = one browser session · a unique visitor = a browser seen for the first time · your own marked devices are not counted · no IP addresses stored</p>
${srcTable(d)}<h2 style="font-size:18px;margin:26px 0 10px">Countries</h2><table><thead><tr><th>Country</th><th class="n">Visits</th><th class="n">Unique</th><th class="n">Share</th><th></th></tr></thead><tbody>${tr || '<tr><td colspan="5">No visits yet</td></tr>'}</tbody></table></main></body></html>`;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);
    const cors = ORIGINS.includes(origin) ? origin : ORIGINS[0];
    if (url.pathname === "/apps") {
      return new Response(JSON.stringify(await appRates(env)), {
        headers: { "Content-Type": "application/json", "Cache-Control": "max-age=600", "Access-Control-Allow-Origin": cors },
      });
    }
    const d = await load(env);
    if (url.pathname === "/hit") {
      const c = (request.cf && request.cf.country) || "XX";
      const isNew = url.searchParams.get("new") === "1";
      const x = d.countries[c] || (d.countries[c] = { v: 0, u: 0 });
      d.visits += 1; x.v += 1;
      if (isNew) { d.uniques += 1; x.u += 1; }
      const src = (url.searchParams.get("src") || "Direct or app").slice(0, 40);
      const s = d.sources[src] || (d.sources[src] = { v: 0, u: 0 });
      s.v += 1; if (isNew) s.u += 1;
      try { await env.COUNTER.put("stats", JSON.stringify(d)); } catch (e) { /* free-tier write limit reached */ }
    }
    if (url.pathname === "/stats") {
      return new Response(statsPage(d), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    }
    return new Response(JSON.stringify({ visits: d.visits }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": ORIGINS.includes(origin) ? origin : ORIGINS[0] },
    });
  },
};
