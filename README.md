# Seep — Online Multiplayer

A real-time, 4-player partnership version of **Seep**. The server is authoritative and deals the cards, so **every hand stays secret** — each player only ever receives their own 13 cards. Zero npm dependencies (plain Node `http` + Server-Sent Events), so it runs immediately and deploys anywhere.

## What's here
- `server.js` — the multiplayer server (rooms, seating, dealing, move validation, per-player state).
- `engine.mjs` — the verified Seep rules engine (same one used by the single-file game).
- `index.html` — the web client (the full game UI; talks to the server over fetch + SSE).
- `package.json` — `npm start` runs the server.

## Run it locally
You need [Node.js](https://nodejs.org) 18 or newer. Then:

```bash
cd seep-server
node server.js
```

You'll see `Seep multiplayer server running on http://localhost:3000`.

- Open **http://localhost:3000** in a browser → enter your name → **Create a room**.
- Three friends open the same URL and **Join** with the 4-letter room code.

### Playing with friends on the same Wi‑Fi
Find your computer's local IP (e.g. `192.168.1.42`):
- macOS: `ipconfig getifaddr en0`
- Windows: `ipconfig` (look for IPv4 Address)
- Linux: `hostname -I`

Friends on the same network open `http://YOUR-IP:3000` on their phones. One creates the room; the others join with the code.

## Play over the internet (deploy)
Because it has no dependencies, it deploys to any Node host in one step. The server reads the port from `process.env.PORT`.

- **Render / Railway / Fly.io / Glitch / a VPS**: point it at this folder, set the start command to `node server.js`, and open the provided URL. Share that URL + room code with friends anywhere.
- No build step, no database — rooms live in memory (fine for casual play; restarting the server clears active rooms).

## How hidden hands work
The browser never receives other players' cards. On every change the server sends each player a redacted view: their own hand in full, everyone else's as face‑down counts. All moves are validated server‑side against the real game state, so you can't play a card you don't hold or move out of turn. Refreshing the page reconnects you to your seat automatically.

## Local 1-device mode
The same page also has a **Pass & Play** tab (one device passed around the table) — handy for testing or in‑person games. That mode runs entirely in the browser and needs no server features.

## The rules in brief
4 players, partners sitting opposite (seats 0 & 2 vs 1 & 3). Capture loose cards and houses by value (including sums like 8+2 with a 10), build and break houses (9–13), and chase the seven **power cards** (all four Aces, 2♠, 9♠, 10♦). First team to capture all seven power cards wins; if both teams hold at least one, it's a draw. The 9♠/10♦ must be "shown" via their house the first time, after which any regular 9/10 can start one.
