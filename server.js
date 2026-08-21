import "dotenv/config";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { connectAgent } from "./deepgram-agent.js";
import { handleExotelStream } from "./exotel/stream.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

if (!process.env.DEEPGRAM_API_KEY) {
  console.error("Missing DEEPGRAM_API_KEY in .env");
  process.exit(1);
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, uptime: process.uptime() }));
  }

  // Exotel StatusCallback lands here.
  if (url.pathname === "/exotel/status") {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      console.log("[exotel status]", body || url.search);
      res.writeHead(200).end("ok");
    });
    return;
  }

  const file = url.pathname === "/" ? "/index.html" : url.pathname;
  const full = path.join(__dirname, "public", path.normalize(file).replace(/^(\.\.[/\\])+/, ""));
  fs.readFile(full, (err, data) => {
    if (err) return res.writeHead(404).end("Not found");
    res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" });
    res.end(data);
  });
});

// Two transports onto the same agent: the browser demo and Exotel telephony.
const browserWss = new WebSocketServer({ noServer: true });
const exotelWss = new WebSocketServer({ noServer: true });

const STREAM_SECRET = process.env.EXOTEL_STREAM_SECRET;
if (!STREAM_SECRET) {
  console.warn("[warn] EXOTEL_STREAM_SECRET is unset — /exotel-stream is open to anyone who\n" +
               "       finds the URL, and each session bills Deepgram. Set it before deploying.");
}

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/agent") {
    return browserWss.handleUpgrade(req, socket, head, (ws) => browserWss.emit("connection", ws, req));
  }

  // Some Exotel applet URL fields strip query strings, so the token is accepted either as
  // ?token=<secret> or as a trailing path segment /exotel-stream/<secret>.
  const streamMatch = url.pathname === "/exotel-stream" || url.pathname.startsWith("/exotel-stream/");
  if (streamMatch) {
    const pathToken = url.pathname.slice("/exotel-stream/".length) || null;
    const token = url.searchParams.get("token") || pathToken;
    if (STREAM_SECRET && token !== STREAM_SECRET) {
      console.warn(`[exotel] rejected unauthenticated upgrade from ${req.socket.remoteAddress}`);
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return socket.destroy();
    }
    return exotelWss.handleUpgrade(req, socket, head, (ws) => exotelWss.emit("connection", ws, req));
  }

  socket.destroy();
});

exotelWss.on("connection", handleExotelStream);

// Browser demo: 24 kHz both ways, key never leaves the server.
browserWss.on("connection", (browser) => {
  console.log("[browser] connected");
  const agent = connectAgent({
    sampleRate: 24000,
    onAudio: (pcm) => {
      if (browser.readyState === browser.OPEN) browser.send(pcm, { binary: true });
    },
    onEvent: (msg) => {
      if (msg.type === "Closed") return browser.close();
      if (browser.readyState === browser.OPEN) browser.send(JSON.stringify(msg));
    },
  });

  browser.on("message", (data, isBinary) => {
    if (isBinary) agent.sendAudio(data);
    else agent.sendRaw(data.toString());
  });
  browser.on("close", () => {
    console.log("[browser] disconnected");
    agent.close();
  });
});

// A crash here kills every in-flight call, so log and keep serving.
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
process.on("uncaughtException", (e) => console.error("[uncaughtException]", e));

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Steelman Solar agent`);
  console.log(`  browser demo  -> http://localhost:${PORT}`);
  console.log(`  exotel stream -> ws://localhost:${PORT}/exotel-stream`);
});
