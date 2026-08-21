// REST API behind the dashboard.
import * as store from "./store.js";
import { startCampaign, stopCampaign, campaignState, dialLead } from "./campaign.js";

const json = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => resolve(b));
  });

/** Returns true if it handled the request. */
export async function handleApi(req, res, url) {
  if (!url.pathname.startsWith("/api/")) return false;
  const p = url.pathname;

  try {
    if (p === "/api/stats" && req.method === "GET") {
      json(res, 200, { ...store.stats(), campaign: campaignState() });
      return true;
    }

    if (p === "/api/leads" && req.method === "GET") {
      json(res, 200, store.listLeads());
      return true;
    }

    if (p === "/api/leads" && req.method === "POST") {
      const body = await readBody(req);
      const ct = req.headers["content-type"] || "";
      let rows;
      if (ct.includes("application/json")) {
        const parsed = JSON.parse(body || "[]");
        rows = Array.isArray(parsed) ? parsed : [parsed];
      } else {
        rows = store.parseCsv(body);
      }
      json(res, 200, store.addLeads(rows));
      return true;
    }

    if (p.startsWith("/api/leads/") && req.method === "DELETE") {
      store.deleteLead(p.split("/")[3]);
      json(res, 200, { ok: true });
      return true;
    }

    if (p.startsWith("/api/leads/") && p.endsWith("/call") && req.method === "POST") {
      json(res, 200, await dialLead(p.split("/")[3]));
      return true;
    }

    if (p === "/api/calls" && req.method === "GET") {
      // Newest first, transcripts trimmed — the detail view fetches the full record.
      const calls = [...store.listCalls()].reverse().map(({ transcript, toolCalls, ...c }) => ({
        ...c,
        turns: transcript.length,
      }));
      json(res, 200, calls);
      return true;
    }

    if (p.startsWith("/api/calls/") && req.method === "GET") {
      const call = store.getCall(p.split("/")[3]);
      if (!call) return json(res, 404, { error: "not found" }), true;
      const lead = call.leadId ? store.getLead(call.leadId) : null;
      json(res, 200, { ...call, lead });
      return true;
    }

    if (p === "/api/campaign/start" && req.method === "POST") {
      json(res, 200, await startCampaign());
      return true;
    }

    if (p === "/api/campaign/stop" && req.method === "POST") {
      json(res, 200, stopCampaign());
      return true;
    }

    json(res, 404, { error: "unknown endpoint" });
    return true;
  } catch (err) {
    console.error("[api]", err);
    json(res, 500, { error: err.message });
    return true;
  }
}
