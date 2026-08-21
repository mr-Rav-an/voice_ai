// File-backed store for leads and calls. Deliberately dependency-free: JSON on disk is
// enough for campaigns in the hundreds and survives restarts, which the in-memory
// version did not. Swap for Postgres when volume or concurrency demands it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "data");
const FILE = path.join(DIR, "store.json");

const empty = { leads: [], calls: [], seq: { lead: 1, call: 1 } };
let db = empty;
let writeTimer = null;

function load() {
  try {
    db = { ...empty, ...JSON.parse(fs.readFileSync(FILE, "utf8")) };
  } catch {
    db = structuredClone(empty);
  }
}

function persist() {
  // Debounced: a live call writes on every transcript line.
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
  }, 250);
}

load();

// A lead is only "calling" while a process is actively dialing it. If we are loading the
// file, no call is in flight — anything left in that state was stranded by a crash or
// restart, so release it back to the queue rather than leaving it undialable forever.
{
  const stranded = db.leads.filter((l) => l.status === "calling");
  if (stranded.length) {
    stranded.forEach((l) => (l.status = "pending"));
    console.log(`[store] released ${stranded.length} lead(s) stranded in "calling"`);
    persist();
  }
}

export const normalizePhone = (raw) => {
  const d = String(raw || "").replace(/\D/g, "");
  const ten = d.length > 10 ? d.slice(-10) : d;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
};

// --- leads -----------------------------------------------------------------
export function addLeads(rows) {
  const added = [];
  const skipped = [];
  for (const row of rows) {
    const phone = normalizePhone(row.phone);
    if (!phone) {
      skipped.push({ ...row, reason: "invalid phone" });
      continue;
    }
    if (db.leads.some((l) => l.phone === phone)) {
      skipped.push({ ...row, phone, reason: "duplicate" });
      continue;
    }
    const lead = {
      id: `L${db.seq.lead++}`,
      name: row.name || "",
      phone,
      city: row.city || "",
      notes: row.notes || "",
      status: "pending", // pending | calling | done | failed | dnc
      attempts: 0,
      lastCallId: null,
      createdAt: new Date().toISOString(),
    };
    db.leads.push(lead);
    added.push(lead);
  }
  persist();
  return { added, skipped };
}

export const listLeads = () => db.leads;
export const getLead = (id) => db.leads.find((l) => l.id === id);
export const findLeadByPhone = (phone) => db.leads.find((l) => l.phone === normalizePhone(phone));

export function updateLead(id, patch) {
  const lead = getLead(id);
  if (lead) Object.assign(lead, patch);
  persist();
  return lead;
}

export function deleteLead(id) {
  const i = db.leads.findIndex((l) => l.id === id);
  if (i >= 0) db.leads.splice(i, 1);
  persist();
}

/** Next lead eligible to dial. */
export function nextPendingLead(maxAttempts = 2) {
  return db.leads.find(
    (l) => (l.status === "pending" || (l.status === "failed" && l.attempts < maxAttempts)) && l.status !== "dnc"
  );
}

// --- calls -----------------------------------------------------------------
export function createCall({ callSid, leadId, phone, direction = "outbound" }) {
  const call = {
    id: `C${db.seq.call++}`,
    callSid: callSid || null,
    leadId: leadId || null,
    phone: normalizePhone(phone) || phone || null,
    direction,
    startedAt: new Date().toISOString(),
    endedAt: null,
    durationSec: null,
    exotelStatus: null,
    connected: false,
    outcome: null, // interested | not_interested | callback | disqualified | no_answer | dnc
    interest: null, // hot | warm | cold
    reason: null,
    captured: {}, // owner, monthlyBill, city, rooftopSqft, systemKw, netCost, savings
    booking: null,
    transcript: [], // {role, text, at}
    toolCalls: [],
  };
  db.calls.push(call);
  persist();
  return call;
}

export const getCall = (id) => db.calls.find((c) => c.id === id);
export const getCallBySid = (sid) => db.calls.find((c) => c.callSid === sid);
export const listCalls = () => db.calls;

export function updateCall(id, patch) {
  const call = getCall(id);
  if (!call) return null;
  if (patch.captured) {
    call.captured = { ...call.captured, ...patch.captured };
    delete patch.captured;
  }
  Object.assign(call, patch);
  persist();
  return call;
}

export function appendTranscript(id, role, text) {
  const call = getCall(id);
  if (!call || !text) return;
  call.transcript.push({ role, text, at: new Date().toISOString() });
  persist();
}

export function appendToolCall(id, name, args, result) {
  const call = getCall(id);
  if (!call) return;
  call.toolCalls.push({ name, args, result, at: new Date().toISOString() });
  persist();
}

// --- stats -----------------------------------------------------------------
export function stats() {
  const calls = db.calls;
  const by = (k) => calls.reduce((a, c) => ((a[c[k] || "unknown"] = (a[c[k] || "unknown"] || 0) + 1), a), {});
  const connected = calls.filter((c) => c.connected);
  return {
    leads: db.leads.length,
    leadsPending: db.leads.filter((l) => l.status === "pending").length,
    calls: calls.length,
    connected: connected.length,
    connectRate: calls.length ? Math.round((connected.length / calls.length) * 100) : 0,
    booked: calls.filter((c) => c.booking).length,
    interested: calls.filter((c) => c.outcome === "interested").length,
    byOutcome: by("outcome"),
    avgDurationSec: connected.length
      ? Math.round(connected.reduce((a, c) => a + (c.durationSec || 0), 0) / connected.length)
      : 0,
  };
}

/** Minimal CSV parser — handles quoted fields and a header row. */
export function parseCsv(text) {
  const rows = [];
  let field = "", row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const has = (h, ...words) => words.some((w) => h.replace(/[\s_-]/g, "").includes(w));
  const idx = (...words) => header.findIndex((h) => has(h, ...words));

  let iPhone = idx("phone", "mobile", "number", "contact", "cell", "whatsapp", "msisdn");
  const iName = idx("name", "customer", "lead", "client");
  const iCity = idx("city", "location", "town", "area");
  const iNotes = idx("note", "remark", "comment");

  // The header row may be absent, or named something we don't recognise. Decide by
  // content instead: pick the column where most values look like Indian mobile numbers.
  const looksHeaderless = rows[0].some((c) => normalizePhone(c));
  const body = looksHeaderless ? rows : rows.slice(1);

  if (iPhone === -1) {
    const width = Math.max(...rows.map((r) => r.length));
    let best = -1, bestHits = 0;
    for (let col = 0; col < width; col++) {
      const hits = body.filter((r) => normalizePhone(r[col])).length;
      if (hits > bestHits) { bestHits = hits; best = col; }
    }
    // Require it to work for at least half the rows, so we don't latch onto a stray cell.
    if (best >= 0 && bestHits >= Math.max(1, Math.floor(body.length / 2))) iPhone = best;
  }
  if (iPhone === -1) return [];

  const pick = (r, i) => (i >= 0 && i !== iPhone ? (r[i] || "").trim() : "");
  return body.filter((r) => r.some((c) => c.trim())).map((r) => ({
    phone: r[iPhone],
    name: pick(r, iName),
    city: pick(r, iCity),
    notes: pick(r, iNotes),
  }));
}
