// MongoDB-backed store for leads and calls.
//
// Documents live in Mongo, but the process also keeps them in memory: the call bridge and
// the tool handlers run inside Deepgram's function-call path, which is synchronous, so
// reads must not await. Writes go to memory immediately and are mirrored to Mongo. That
// means one writer process — run a single instance until the read paths are made async.
import { MongoClient } from "mongodb";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DB_NAME = process.env.MONGO_DB || "AI";
const LEADS = "solar_leads"; // namespaced: the AI database is shared
const CALLS = "solar_calls";

let client = null;
let db = null;
let leadsCol = null;
let callsCol = null;
let ready = false;

const mem = { leads: [], calls: [] };
const seq = { lead: 1, call: 1 };

const nextId = (prefix, key) => `${prefix}${seq[key]++}`;

/** Mirror a document to Mongo. Failures are logged, never thrown into a live call. */
function mirror(col, doc) {
  if (!ready || !col) return;
  col.replaceOne({ id: doc.id }, doc, { upsert: true }).catch((e) =>
    console.error(`[store] write failed for ${doc.id}:`, e.message)
  );
}

export async function init() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is not set");

  client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  db = client.db(DB_NAME);
  leadsCol = db.collection(LEADS);
  callsCol = db.collection(CALLS);

  await leadsCol.createIndex({ id: 1 }, { unique: true });
  await leadsCol.createIndex({ phone: 1 }, { unique: true });
  await callsCol.createIndex({ id: 1 }, { unique: true });
  await callsCol.createIndex({ callSid: 1 });
  await callsCol.createIndex({ startedAt: -1 });

  mem.leads = await leadsCol.find({}, { projection: { _id: 0 } }).toArray();
  mem.calls = await callsCol.find({}, { projection: { _id: 0 } }).toArray();
  ready = true;

  const maxNum = (arr, p) =>
    arr.reduce((m, x) => Math.max(m, Number(String(x.id).replace(p, "")) || 0), 0);
  seq.lead = maxNum(mem.leads, "L") + 1;
  seq.call = maxNum(mem.calls, "C") + 1;

  await migrateJsonFile();

  // A lead is only "calling" while a process is dialing it. Nothing is in flight at
  // startup, so release anything a crash left stranded rather than stranding it forever.
  const stranded = mem.leads.filter((l) => l.status === "calling");
  stranded.forEach((l) => { l.status = "pending"; mirror(leadsCol, l); });

  console.log(
    `[store] mongo ${DB_NAME}.${LEADS}/${CALLS} — ${mem.leads.length} leads, ${mem.calls.length} calls` +
    (stranded.length ? `, released ${stranded.length} stranded` : "")
  );
  return db;
}

/** Shared Mongo database handle (after init). */
export function getDb() {
  return db;
}

/** One-time import of the old file store, so nothing from local testing is lost. */
async function migrateJsonFile() {
  if (mem.leads.length || mem.calls.length) return;
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "data", "store.json");
  if (!fs.existsSync(file)) return;
  try {
    const old = JSON.parse(fs.readFileSync(file, "utf8"));
    if (old.leads?.length) {
      mem.leads = old.leads;
      await leadsCol.insertMany(old.leads, { ordered: false }).catch(() => {});
    }
    if (old.calls?.length) {
      mem.calls = old.calls;
      await callsCol.insertMany(old.calls, { ordered: false }).catch(() => {});
    }
    if (old.seq) Object.assign(seq, old.seq);
    fs.renameSync(file, file + ".migrated");
    console.log(`[store] migrated ${old.leads?.length || 0} leads / ${old.calls?.length || 0} calls from data/store.json`);
  } catch (e) {
    console.error("[store] migration skipped:", e.message);
  }
}

export async function close() {
  ready = false;
  if (client) await client.close();
}

export const normalizePhone = (raw) => {
  const d = String(raw || "").replace(/\D/g, "");
  const ten = d.length > 10 ? d.slice(-10) : d;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
};

// --- leads -----------------------------------------------------------------
export function addLeads(rows) {
  const added = [], skipped = [];
  for (const row of rows) {
    const phone = normalizePhone(row.phone);
    if (!phone) { skipped.push({ ...row, reason: "invalid phone" }); continue; }
    if (mem.leads.some((l) => l.phone === phone)) {
      skipped.push({ ...row, phone, reason: "duplicate" });
      continue;
    }
    const lead = {
      id: nextId("L", "lead"),
      name: row.name || "", phone, city: row.city || "", notes: row.notes || "",
      status: "pending", attempts: 0, lastCallId: null,
      createdAt: new Date().toISOString(),
    };
    mem.leads.push(lead);
    mirror(leadsCol, lead);
    added.push(lead);
  }
  return { added, skipped };
}

export const listLeads = () => mem.leads;
export const getLead = (id) => mem.leads.find((l) => l.id === id);
export const findLeadByPhone = (phone) => mem.leads.find((l) => l.phone === normalizePhone(phone));

export function updateLead(id, patch) {
  const lead = getLead(id);
  if (!lead) return null;
  Object.assign(lead, patch);
  mirror(leadsCol, lead);
  return lead;
}

export function deleteLead(id) {
  const i = mem.leads.findIndex((l) => l.id === id);
  if (i < 0) return;
  mem.leads.splice(i, 1);
  if (ready) leadsCol.deleteOne({ id }).catch((e) => console.error("[store] delete failed:", e.message));
}

export function nextPendingLead(maxAttempts = 2) {
  return mem.leads.find(
    (l) => l.status !== "dnc" && (l.status === "pending" || (l.status === "failed" && l.attempts < maxAttempts))
  );
}

// --- calls -----------------------------------------------------------------
export function createCall({ callSid, leadId, phone, direction = "outbound" }) {
  const call = {
    id: nextId("C", "call"),
    callSid: callSid || null, leadId: leadId || null,
    phone: normalizePhone(phone) || phone || null,
    direction, startedAt: new Date().toISOString(),
    endedAt: null, durationSec: null, exotelStatus: null, connected: false,
    outcome: null, interest: null, reason: null,
    captured: {}, booking: null, transcript: [], toolCalls: [],
  };
  mem.calls.push(call);
  mirror(callsCol, call);
  return call;
}

export const getCall = (id) => mem.calls.find((c) => c.id === id);
export const getCallBySid = (sid) => mem.calls.find((c) => c.callSid === sid);
export const listCalls = () => mem.calls;

export function updateCall(id, patch) {
  const call = getCall(id);
  if (!call) return null;
  if (patch.captured) {
    call.captured = { ...call.captured, ...patch.captured };
    patch = { ...patch };
    delete patch.captured;
  }
  Object.assign(call, patch);
  mirror(callsCol, call);
  return call;
}

export function appendTranscript(id, role, text) {
  const call = getCall(id);
  if (!call || !text) return;
  call.transcript.push({ role, text, at: new Date().toISOString() });
  mirror(callsCol, call);
}

export function appendToolCall(id, name, args, result) {
  const call = getCall(id);
  if (!call) return;
  call.toolCalls.push({ name, args, result, at: new Date().toISOString() });
  mirror(callsCol, call);
}

// --- stats -----------------------------------------------------------------
export function stats() {
  const calls = mem.calls;
  const by = (k) => calls.reduce((a, c) => ((a[c[k] || "unknown"] = (a[c[k] || "unknown"] || 0) + 1), a), {});
  const connected = calls.filter((c) => c.connected);
  return {
    leads: mem.leads.length,
    leadsPending: mem.leads.filter((l) => l.status === "pending").length,
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

/** Minimal CSV parser — quoted fields, optional header, phone column found by content. */
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
  let iName = idx("name", "customer", "client");
  // "address" is what operators often type instead of city
  let iCity = idx("city", "location", "town", "area", "address", "addr");
  let iNotes = idx("note", "remark", "comment");

  const looksHeaderless = rows[0].some((c) => normalizePhone(c));
  const body = looksHeaderless ? rows : rows.slice(1);

  if (iPhone === -1) {
    const width = Math.max(...rows.map((r) => r.length));
    let best = -1, bestHits = 0;
    for (let col = 0; col < width; col++) {
      const hits = body.filter((r) => normalizePhone(r[col])).length;
      if (hits > bestHits) { bestHits = hits; best = col; }
    }
    if (best >= 0 && bestHits >= Math.max(1, Math.floor(body.length / 2))) iPhone = best;
  }
  if (iPhone === -1) return [];

  // Headerless / odd headers: columns left of phone → name, right → city (then notes)
  if (looksHeaderless || (iName < 0 && iCity < 0)) {
    iName = -1;
    iCity = -1;
    iNotes = -1;
  }

  const pick = (r, i) => (i >= 0 && i !== iPhone ? (r[i] || "").trim() : "");
  return body.filter((r) => r.some((c) => c.trim())).map((r) => {
    let name = pick(r, iName);
    let city = pick(r, iCity);
    let notes = pick(r, iNotes);
    if (!name || !city) {
      const left = r.slice(0, iPhone).map((c) => (c || "").trim()).filter(Boolean);
      const right = r.slice(iPhone + 1).map((c) => (c || "").trim()).filter(Boolean);
      if (!name && left.length) name = left[0];
      if (!city && right.length) city = right[0];
      if (!notes && right.length > 1) notes = right.slice(1).join("; ");
    }
    return { phone: r[iPhone], name, city, notes };
  });
}
