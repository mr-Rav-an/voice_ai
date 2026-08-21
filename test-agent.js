// Headless smoke test: connects to the local proxy, drives a scripted Hinglish
// conversation with InjectUserMessage, and prints transcripts + tool calls.
import { WebSocket } from "ws";
import fs from "node:fs";

const chunks = [];

const SCRIPT = [
  "Haan boliye, kaun bol raha hai?",
  "Ghar apna hai, Jaipur mein. Bill lagbhag paanch hazaar aata hai har mahine.",
  "Chhat khaali hai, lagbhag chaar sau square feet. Kitna kharcha aayega?",
  "Theek hai, kal ka koi slot hai kya?",
  "Subah dus baje thik hai. Naam Ankur, number nau nau eight seven six five four three two one.",
];

const ws = new WebSocket("ws://localhost:3000/agent");
let i = 0, audioBytes = 0, tools = [];

const next = () => {
  if (i >= SCRIPT.length) return setTimeout(finish, 6000);
  const line = SCRIPT[i++];
  console.log(`\n\x1b[36m[user]\x1b[0m ${line}`);
  ws.send(JSON.stringify({ type: "InjectUserMessage", content: line }));
};

function finish() {
  const pcm = Buffer.concat(chunks);
  const hdr = Buffer.alloc(44);
  hdr.write("RIFF", 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write("WAVE", 8);
  hdr.write("fmt ", 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22);
  hdr.writeUInt32LE(24000, 24); hdr.writeUInt32LE(48000, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34);
  hdr.write("data", 36); hdr.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync("agent-call.wav", Buffer.concat([hdr, pcm]));
  console.log(`\n--- audio: ${audioBytes} bytes -> agent-call.wav | tools: ${tools.join(", ") || "none"} ---`);
  ws.close();
  process.exit(0);
}

ws.on("open", () => console.log("connected to proxy"));
ws.on("message", (data, isBinary) => {
  if (isBinary) { audioBytes += data.length; chunks.push(data); return; }
  const m = JSON.parse(data.toString());
  if (m.type === "Welcome") setTimeout(next, 1500);
  if (m.type === "ConversationText" && m.role === "assistant")
    console.log(`\x1b[33m[agent]\x1b[0m ${m.content}`);
  if (m.type === "ToolCall") {
    tools.push(m.name);
    console.log(`\x1b[32m[tool]\x1b[0m ${m.name}(${m.args}) -> ${JSON.stringify(m.result)}`);
  }
  if (m.type === "AgentAudioDone") setTimeout(next, 800);
  if (m.type === "Error" || m.type === "Warning") console.log(`\x1b[31m[${m.type}]\x1b[0m`, m);
});
ws.on("close", () => process.exit(0));
setTimeout(finish, 90000);
