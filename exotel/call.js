#!/usr/bin/env node
// Place one outbound call:  node exotel/call.js 09XXXXXXXXX
import "dotenv/config";
import { callWithVoicebot, verify } from "./client.js";

const to = process.argv[2];
if (!to) {
  console.error("usage: node exotel/call.js <number>   e.g. 09876543210");
  process.exit(1);
}
if (!/^0?[6-9]\d{9}$|^\+91[6-9]\d{9}$/.test(to.replace(/[\s-]/g, ""))) {
  console.error(`"${to}" doesn't look like an Indian mobile number.`);
  process.exit(1);
}

let check;
try {
  check = await verify();
} catch (e) {
  console.error(`\x1b[31m${e.message}\x1b[0m`);
  process.exit(1);
}
if (!check.ok) {
  console.error("Credential check failed:", check.error);
  process.exit(1);
}

const res = await callWithVoicebot(to);
const call = res?.Call || res;
console.log(`Calling ${to} — sid=${call?.Sid} status=${call?.Status}`);
console.log(`Check status: node -e "import('./exotel/client.js').then(m=>m.getCall('${call?.Sid}').then(r=>console.log(JSON.stringify(r,null,2))))"`);
