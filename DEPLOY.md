# Get a shareable link (free)

You need a live server for friends to join. Easiest path, ~5 minutes, no terminal:

## Option A — Render (recommended, browser-only)
1. Put these files in a GitHub repo:
   - Go to github.com → New repository → name it `seep-online`.
   - Click "uploading an existing file" and drag in everything from this folder
     (all of them: server.js, engine.mjs, index.html, package.json, render.yaml, Dockerfile).
   - Commit.
2. Go to render.com → sign up (free) → New → Web Service → connect your GitHub → pick the repo.
   Render reads `render.yaml` and fills everything in. Click Create / Deploy.
3. After a minute you get a URL like `https://seep-online-xxxx.onrender.com`.
   That's your link — share it. One person Creates a room, the others Join with the code.

Note: the free tier sleeps after ~15 min idle, so the very first visit can take 30–60s to wake. Fine for game night.

## Option B — Railway
1. railway.app → New Project → Deploy from GitHub → pick the repo.
2. Open the service → Settings → Networking → Generate Domain. That URL is your link.

## Option C — Fly.io (needs the small `flyctl` tool)
1. Install flyctl, run `flyctl launch` in this folder, accept defaults.
2. It deploys the Dockerfile and prints your URL.

## Run it on your own computer (no hosting)
`node server.js`, then friends on the SAME Wi-Fi open `http://YOUR-LOCAL-IP:3000`.
(Find your IP: macOS `ipconfig getifaddr en0`, Windows `ipconfig`, Linux `hostname -I`.)
