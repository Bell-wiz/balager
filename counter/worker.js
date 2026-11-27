// Balager visit counter: a Cloudflare Worker with one KV namespace bound as COUNTER.
// GET /       -> {"visits": n}                (read only, used by the site footer)
// GET /hit    -> {"visits": n+1}              (counts one visit and its country)
// GET /stats  -> page: visits by country      (no IP addresses are stored)
const ORIGINS = ["https://balagerhub.com", "https://www.balagerhub.com", "http://balagerhub.com"];

async function load(env) {
  let d = null;
  try { d = JSON.parse((await env.COUNTER.get("stats")) || "null"); } catch (e) {}
  if (!d) {
    const old = parseInt((await env.COUNTER.get("visits")) || "0", 10);
    d = { visits: old, countries: {}, since: new Date().toISOString().slice(0, 10) };
  }
  return d;
}

function countryName(code) {
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code; } catch (e) { return code; }
}

function statsPage(d) {
  const counted = Object.values(d.countries).reduce((a, b) => a + b, 0);
  const rows = Object.entries(d.countries).sort((a, b) => b[1] - a[1]);
  if (d.visits > counted) rows.push(["--", d.visits - counted]);
  const tr = rows.map(([c, n]) => {
    const name = c === "--" ? "Before country tracking" : c === "XX" || c === "T1" ? "Unknown" : countryName(c);
    const pct = d.visits ? ((n / d.visits) * 100).toFixed(1) : "0";
    return `<tr><td>${name}</td><td class="n">${n.toLocaleString("en-US")}</td><td class="n">${pct}%</td><td><i style="width:${pct}%"></i></td></tr>`;
  }).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Balager visits by country</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:24px 16px;background:#f6f5f0;color:#141814}main{max-width:720px;margin:auto}h1{margin:0 0 4px;font-size:28px}p{color:#566057;margin:0 0 20px}table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden}td,th{padding:10px 12px;border-bottom:1px solid #e2e1da;text-align:left}th{font-size:13px;color:#566057;font-weight:500}.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}td:last-child{width:30%}i{display:block;height:8px;border-radius:4px;background:#1f9d6b}</style></head>
<body><main><h1>${d.visits.toLocaleString("en-US")} visits</h1><p>balagerhub.com · countries since ${d.since} · one count per browser session · no IP addresses stored</p>
<table><thead><tr><th>Country</th><th class="n">Visits</th><th class="n">Share</th><th></th></tr></thead><tbody>${tr || '<tr><td colspan="4">No visits yet</td></tr>'}</tbody></table></main></body></html>`;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const path = new URL(request.url).pathname;
    const d = await load(env);
    if (path === "/hit") {
      const c = (request.cf && request.cf.country) || "XX";
      d.visits += 1;
      d.countries[c] = (d.countries[c] || 0) + 1;
      try { await env.COUNTER.put("stats", JSON.stringify(d)); } catch (e) { /* free-tier write limit reached */ }
    }
    if (path === "/stats") {
      return new Response(statsPage(d), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    }
    return new Response(JSON.stringify({ visits: d.visits }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": ORIGINS.includes(origin) ? origin : ORIGINS[0],
      },
    });
  },
};
