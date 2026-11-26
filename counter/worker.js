// Balager visit counter: a Cloudflare Worker with one KV namespace bound as COUNTER.
// GET /      -> {"visits": n}      (read only)
// GET /hit   -> {"visits": n+1}    (counts one visit)
const ORIGINS = ["https://balagerhub.com", "https://www.balagerhub.com", "http://balagerhub.com"];

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": ORIGINS.includes(origin) ? origin : ORIGINS[0],
    };
    const path = new URL(request.url).pathname;
    let visits = parseInt((await env.COUNTER.get("visits")) || "0", 10);
    if (path === "/hit") {
      visits += 1;
      try { await env.COUNTER.put("visits", String(visits)); } catch (e) { /* free-tier write limit reached: still answer */ }
    }
    return new Response(JSON.stringify({ visits }), { headers });
  },
};
