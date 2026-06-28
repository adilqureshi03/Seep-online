// Seep — server-authoritative multiplayer (zero dependencies: Node http + Server-Sent Events)
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import url from "url";
import { newGame, applyMove } from "./engine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

/** rooms: code -> { code, players:[{token,name,seat,res,alive}], game, hostToken, createdAt } */
const rooms = new Map();
const ALPHABET = "ACDEFGHJKLMNPQRSTUVWXYZ23456789";
const genCode = () => { let c; do { c = Array.from({length:4},()=>ALPHABET[Math.random()*ALPHABET.length|0]).join(""); } while (rooms.has(c)); return c; };
const genToken = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const teamOf = (s) => (s % 2 === 0 ? "A" : "B");

function redactFor(game, seat) {
  const g = JSON.parse(JSON.stringify(game));
  for (const s of [0,1,2,3]) if (s !== seat && g.hands[s]) g.hands[s] = g.hands[s].map(() => null); // hide others' cards, keep counts
  return g;
}
const roomView = (room) => ({
  code: room.code,
  players: room.players.map(p => ({ name: p.name, seat: p.seat, connected: p.alive })),
  started: !!room.game,
  hostSeat: (room.players.find(p => p.token === room.hostToken) || {}).seat,
});
function pushTo(room, player) {
  if (!player.res) return;
  const payload = { room: roomView(room), game: room.game ? redactFor(room.game, player.seat) : null, youSeat: player.seat };
  try { player.res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch (_) {}
}
const broadcast = (room) => { for (const p of room.players) pushTo(room, p); };
const sendJSON = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(JSON.stringify(obj)); };

const server = http.createServer((req, res) => {
  const u = url.parse(req.url, true);

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }

  // ---- SSE stream: server -> client state pushes ----
  if (u.pathname === "/sse") {
    const { code, token } = u.query;
    const room = rooms.get(code);
    const player = room && room.players.find(p => p.token === token);
    if (!room || !player) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "Access-Control-Allow-Origin": "*" });
    res.write(":ok\n\n");
    player.res = res; player.alive = true;
    pushTo(room, player);
    broadcast(room); // let others see the updated "connected" status
    const hb = setInterval(() => { try { res.write(":hb\n\n"); } catch (_) {} }, 20000);
    req.on("close", () => { clearInterval(hb); if (player.res === res) { player.res = null; player.alive = false; broadcast(room); } });
    return;
  }

  // ---- API: client -> server actions ----
  if (u.pathname === "/api" && req.method === "POST") {
    let body = "";
    req.on("data", d => { body += d; if (body.length > 1e5) req.destroy(); });
    req.on("end", () => {
      let m; try { m = JSON.parse(body || "{}"); } catch { return sendJSON(res, 400, { error: "bad json" }); }
      try { handleApi(m, res); } catch (e) { sendJSON(res, 500, { error: String((e && e.message) || e) }); }
    });
    return;
  }

  // ---- serve the client (single file, lives next to server.js) ----
  if (u.pathname === "/" || u.pathname === "/index.html") {
    return fs.readFile(path.join(__dirname, "index.html"), (err, data) => {
      if (err) { res.writeHead(500); return res.end("index.html is missing"); }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(data);
    });
  }
  res.writeHead(404); res.end("Not found");
});

function handleApi(m, res) {
  if (m.type === "create") {
    const code = genCode(), token = genToken();
    const room = { code, players: [{ token, name: (m.name || "Player").slice(0,20), seat: 0, res: null, alive: false }], game: null, hostToken: token, createdAt: Date.now() };
    rooms.set(code, room);
    return sendJSON(res, 200, { code, token, seat: 0 });
  }
  const room = rooms.get(m.code);
  if (!room) return sendJSON(res, 404, { error: "No room with that code" });

  if (m.type === "join") {
    let player = room.players.find(p => p.token === m.token);
    if (!player) {
      const taken = new Set(room.players.map(p => p.seat));
      const seat = [0,1,2,3].find(s => !taken.has(s));
      if (seat === undefined) return sendJSON(res, 403, { error: "Room is full" });
      player = { token: genToken(), name: (m.name || "Player").slice(0,20), seat, res: null, alive: false };
      room.players.push(player);
    }
    broadcast(room);
    return sendJSON(res, 200, { code: room.code, token: player.token, seat: player.seat });
  }

  const player = room.players.find(p => p.token === m.token);
  if (!player) return sendJSON(res, 403, { error: "Not in this room" });

  if (m.type === "seat") {
    if (room.game) return sendJSON(res, 400, { error: "Game already started" });
    if (room.players.some(p => p.seat === m.seat && p !== player)) return sendJSON(res, 409, { error: "Seat taken" });
    player.seat = m.seat; broadcast(room); return sendJSON(res, 200, { seat: m.seat });
  }
  if (m.type === "rename") { player.name = (m.name||"Player").slice(0,20); broadcast(room); return sendJSON(res,200,{ok:true}); }
  if (m.type === "start") {
    if (room.players.length < 4) return sendJSON(res, 400, { error: "Need 4 players to start" });
    const seated = [...room.players].sort((a,b) => a.seat - b.seat);
    const meta = seated.map(p => ({ name: p.name, seat: p.seat, team: teamOf(p.seat) }));
    room.game = newGame(meta, (Math.random()*1e9)|0);
    broadcast(room); return sendJSON(res, 200, { ok: true });
  }
  if (m.type === "move") {
    if (!room.game) return sendJSON(res, 400, { error: "No game in progress" });
    if (room.game.turn !== player.seat) return sendJSON(res, 400, { error: "Not your turn" });
    const r = applyMove(room.game, player.seat, m.move);
    if (!r.ok) return sendJSON(res, 400, { error: r.error });
    room.game = r.state; broadcast(room); return sendJSON(res, 200, { ok: true });
  }
  if (m.type === "rematch") {
    if (!room.game) return sendJSON(res, 400, { error: "No game" });
    room.game = newGame(room.game.players, (Math.random()*1e9)|0);
    broadcast(room); return sendJSON(res, 200, { ok: true });
  }
  if (m.type === "leave") {
    room.players = room.players.filter(p => p !== player);
    if (room.players.length === 0) rooms.delete(room.code); else broadcast(room);
    return sendJSON(res, 200, { ok: true });
  }
  return sendJSON(res, 400, { error: "Unknown action" });
}

// sweep idle empty rooms hourly
setInterval(() => { const now = Date.now(); for (const [c, r] of rooms) if (r.players.every(p => !p.alive) && now - r.createdAt > 2*3600e3) rooms.delete(c); }, 3600e3);

server.listen(PORT, () => console.log(`Seep multiplayer server running on http://localhost:${PORT}`));
