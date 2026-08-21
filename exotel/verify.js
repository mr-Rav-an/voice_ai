#!/usr/bin/env node
// Checks Exotel credentials, and retries with key/token swapped if the first order fails.
import "dotenv/config";
import { verify } from "./client.js";

let r;
try {
  r = await verify();
} catch (e) {
  console.error(`\x1b[31m${e.message}\x1b[0m`);
  process.exit(1);
}
if (!r.ok && r.status === 401) {
  console.log("First order rejected — retrying with EXOTEL_API_KEY / EXOTEL_API_TOKEN swapped…");
  const k = process.env.EXOTEL_API_KEY;
  process.env.EXOTEL_API_KEY = process.env.EXOTEL_API_TOKEN;
  process.env.EXOTEL_API_TOKEN = k;
  r = await verify();
  if (r.ok) console.log("\x1b[33mSwapped order works — flip the two values in .env.\x1b[0m");
}
console.log(r.ok ? `\x1b[32mCredentials OK\x1b[0m (sid=${r.sid}, ${r.subdomain})` : `\x1b[31mFailed:\x1b[0m ${r.error}`);
process.exit(r.ok ? 0 : 1);
