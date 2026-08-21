// Exotel Voice v1 REST client.
import "dotenv/config";

const cfg = () => {
  const {
    EXOTEL_API_KEY, EXOTEL_API_TOKEN, EXOTEL_ACCOUNT_SID,
    EXOTEL_SUBDOMAIN = "api.in.exotel.com", EXOTEL_CALLER_ID,
  } = process.env;
  const missing = ["EXOTEL_API_KEY", "EXOTEL_API_TOKEN", "EXOTEL_ACCOUNT_SID"]
    .filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing in .env: ${missing.join(", ")}`);
  return { EXOTEL_API_KEY, EXOTEL_API_TOKEN, EXOTEL_ACCOUNT_SID, EXOTEL_SUBDOMAIN, EXOTEL_CALLER_ID };
};

async function request(path, body) {
  const c = cfg();
  const auth = Buffer.from(`${c.EXOTEL_API_KEY}:${c.EXOTEL_API_TOKEN}`).toString("base64");
  const url = `https://${c.EXOTEL_SUBDOMAIN}/v1/Accounts/${c.EXOTEL_ACCOUNT_SID}/${path}`;
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(body ? { body: new URLSearchParams(body).toString() } : {}),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`Exotel ${res.status}: ${json?.RestException?.Message || text.slice(0, 300)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

/**
 * Dial `to`, and on answer hand the call to the Exotel App containing the
 * Voicebot applet — which opens a websocket to our stream bridge.
 */
export async function callWithVoicebot(to, { appId, callerId, statusCallback, customField } = {}) {
  const c = cfg();
  const app = appId || process.env.EXOTEL_APP_ID;
  if (!app) throw new Error("Missing EXOTEL_APP_ID (the App/flow that holds the Voicebot applet)");
  return request("Calls/connect.json", {
    From: to,
    CallerId: callerId || c.EXOTEL_CALLER_ID,
    Url: `http://my.exotel.com/${c.EXOTEL_ACCOUNT_SID}/exoml/start_voice/${app}`,
    CallType: "trans",
    ...(statusCallback ? { StatusCallback: statusCallback } : {}),
    ...(customField ? { CustomField: customField } : {}),
  });
}

export const getCall = (callSid) => request(`Calls/${callSid}.json`);

/** Cheap credential check — also tells you if key/token are swapped. */
export async function verify() {
  const c = cfg();
  try {
    const r = await request("Calls.json?PageSize=1");
    return { ok: true, subdomain: c.EXOTEL_SUBDOMAIN, sid: c.EXOTEL_ACCOUNT_SID, sample: r };
  } catch (e) {
    return { ok: false, status: e.status, error: e.message };
  }
}
