// Session-cookie admin auth. Users live in Mongo DB `AI`, collection `AI`.
import crypto from "node:crypto";
import { MongoClient } from "mongodb";

const DB_NAME = process.env.MONGO_DB || "AI";
const USERS = process.env.MONGO_USERS_COLLECTION || "AI";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE = "sid";

const sessions = new Map(); // sid -> { username, exp }
let usersCol = null;
let clientOwned = null; // only set if we opened our own client

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const next = crypto.scryptSync(password, salt, 64).toString("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(next, "hex"), Buffer.from(hash, "hex"));
  } catch {
    return false;
  }
}

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const out = {};
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isSecure(req) {
  const xf = (req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  return xf === "https" || process.env.COOKIE_SECURE === "1";
}

function setSessionCookie(res, req, sid) {
  const parts = [
    `${COOKIE}=${encodeURIComponent(sid)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isSecure(req)) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res, req) {
  const parts = [`${COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (isSecure(req)) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

export async function initAuth(existingDb) {
  if (existingDb) {
    usersCol = existingDb.collection(USERS);
  } else {
    const uri = process.env.MONGO_URI;
    if (!uri) throw new Error("MONGO_URI is not set");
    clientOwned = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
    await clientOwned.connect();
    usersCol = clientOwned.db(DB_NAME).collection(USERS);
  }

  await usersCol.createIndex({ username: 1 }, { unique: true });

  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "password";
  const existing = await usersCol.findOne({ username });
  if (!existing) {
    const { salt, hash } = hashPassword(password);
    await usersCol.insertOne({
      username,
      salt,
      passwordHash: hash,
      role: "admin",
      createdAt: new Date().toISOString(),
    });
    console.log(`[auth] seeded admin user "${username}" in ${DB_NAME}.${USERS}`);
  } else {
    console.log(`[auth] admin ready (${DB_NAME}.${USERS})`);
  }
}

export async function closeAuth() {
  if (clientOwned) await clientOwned.close();
}

export function getSession(req) {
  const sid = parseCookies(req)[COOKIE];
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (Date.now() > s.exp) {
    sessions.delete(sid);
    return null;
  }
  return s;
}

export function requireAuth(req, res) {
  const s = getSession(req);
  if (s) return s;
  const wantsJson = (req.headers.accept || "").includes("application/json")
    || req.url?.startsWith("/api/");
  if (wantsJson) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
  } else {
    res.writeHead(302, { Location: "/login" });
    res.end();
  }
  return null;
}

export async function login(username, password) {
  const user = await usersCol.findOne({ username: String(username || "").trim() });
  if (!user || !verifyPassword(password, user.salt, user.passwordHash)) {
    return { ok: false, error: "Invalid username or password" };
  }
  const sid = crypto.randomBytes(32).toString("hex");
  sessions.set(sid, { username: user.username, exp: Date.now() + SESSION_TTL_MS });
  return { ok: true, sid, username: user.username };
}

export function attachLoginCookie(res, req, sid) {
  setSessionCookie(res, req, sid);
}

export function logout(req, res) {
  const sid = parseCookies(req)[COOKIE];
  if (sid) sessions.delete(sid);
  clearSessionCookie(res, req);
}
