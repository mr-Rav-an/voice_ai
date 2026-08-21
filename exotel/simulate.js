#!/usr/bin/env node
// Pretends to be Exotel's Voicebot applet: speaks the exact websocket protocol at the
// bridge, feeds silence as caller audio, and validates the media frames coming back.
// Writes the agent's speech to exotel-call.wav (8 kHz).
import { WebSocket } from "ws";
import fs from "node:fs";

const URL_ = process.env.WS_URL || "ws://localhost:3000/exotel-stream";
const STREAM_SID = `sim_stream_${Date.now()}`;
const CALL_SID = `sim_call_${Date.now()}`;
const ws = new WebSocket(URL_);

let seq = 1, chunk = 1;
const received = [];
const problems = [];
let cleared = 0, marks = 0;

ws.on("open", () => {
  console.log("connected to bridge");
  ws.send(JSON.stringify({ event: "connected" }));
  ws.send(JSON.stringify({
    event: "start", sequence_number: seq++, stream_sid: STREAM_SID,
    start: {
      stream_sid: STREAM_SID, call_sid: CALL_SID, account_sid: "testsid",
      from: "09876543210", to: "01141170795",
      custom_parameters: {},
      media_format: { encoding: "base64", sample_rate: "8000", bit_rate: "16" },
    },
  }));

  // 100ms of silence every 100ms, like a real caller's inbound stream.
  const silence = Buffer.alloc(3200).toString("base64");
  const timer = setInterval(() => {
    if (ws.readyState !== ws.OPEN) return clearInterval(timer);
    ws.send(JSON.stringify({
      event: "media", sequence_number: seq++, stream_sid: STREAM_SID,
      media: { chunk: chunk++, timestamp: String(Date.now()), payload: silence },
    }));
  }, 100);
});

ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.event === "media") {
    const buf = Buffer.from(m.media.payload, "base64");
    if (buf.length % 320 !== 0) problems.push(`chunk of ${buf.length}B is not a multiple of 320`);
    if (buf.length > 100 * 1024) problems.push(`chunk of ${buf.length}B exceeds Exotel's 100k max`);
    if (m.stream_sid !== STREAM_SID) problems.push(`wrong stream_sid: ${m.stream_sid}`);
    received.push(buf);
  } else if (m.event === "clear") { cleared++; console.log("<- clear (barge-in)"); }
  else if (m.event === "mark") { marks++; console.log(`<- mark ${m.mark?.name}`); }
});

setTimeout(() => {
  ws.send(JSON.stringify({
    event: "stop", sequence_number: seq++, stream_sid: STREAM_SID,
    stop: { call_sid: CALL_SID, account_sid: "testsid", reason: "callended" },
  }));
  const pcm = Buffer.concat(received);
  if (pcm.length) {
    const h = Buffer.alloc(44);
    h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
    h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
    h.writeUInt32LE(8000, 24); h.writeUInt32LE(16000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
    h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
    fs.writeFileSync("exotel-call.wav", Buffer.concat([h, pcm]));
  }
  const sizes = [...new Set(received.map((b) => b.length))];
  console.log(`\nframes=${received.length} bytes=${pcm.length} (${(pcm.length / 16000).toFixed(1)}s of 8kHz audio)`);
  console.log(`frame sizes seen: ${sizes.join(", ")} | marks=${marks} clears=${cleared}`);
  console.log(problems.length
    ? `\x1b[31mPROTOCOL PROBLEMS:\x1b[0m\n  ${problems.slice(0, 5).join("\n  ")}`
    : "\x1b[32mprotocol OK — all frames 320-aligned, correct stream_sid\x1b[0m");
  console.log(pcm.length ? "wrote exotel-call.wav" : "\x1b[31mno audio received\x1b[0m");
  ws.close();
  process.exit(problems.length || !pcm.length ? 1 : 0);
}, 14000);
