# Nomad Chats

A WhatsApp-style messenger: 1:1 and group chats, image/file sharing, and WebRTC voice/video calls (including group calls). UI available in English and Russian.

## Features

- **Accounts** — register with username + password, sessions persist across visits via a secure cookie (stays logged in on that device).
- **Direct & group chats** — real-time messaging over Socket.io, typing indicators, online/last-seen presence, unread counts.
- **Groups** — create groups, add/remove members, admin roles, group avatar/name.
- **Media sharing** — send images and files (PDF, docs, zip, txt) in any chat.
- **Calls** — WebRTC voice and video calls, 1:1 and full-mesh group calls, signaled over Socket.io (STUN by default; set `TURN_*` env vars for reliable calls on restrictive networks — see "Notes on calls" below).
- **Languages** — English and Russian, switchable from the login screen or inside the app; each user's choice is saved to their profile.

## Running locally

```bash
npm install
npm start
```

Then open **http://localhost:3000**.

Data is stored in a local SQLite database at `data/nexchat.db` (created automatically). Uploaded images/files are stored in `data/uploads/`. The whole `data/` folder is gitignored — safe to delete to reset all data.

## Deploying (Fly.io)

The app ships with a `Dockerfile` and `fly.toml` so it can run as a single persistent Fly machine — a mounted volume keeps the SQLite database and uploaded images across restarts/redeploys.

```bash
# 1. Install the Fly CLI and log in (opens a browser)
curl -L https://fly.io/install.sh | sh
fly auth login

# 2. Create the app (pick a globally-unique name) and the persistent volume
fly launch --no-deploy --copy-config --name your-unique-name --region iad
fly volumes create nexchat_data --size 1 --region iad

# 3. Deploy
fly deploy
```

Fly prints your public URL (`https://your-unique-name.fly.dev`) when the deploy finishes.

**Important**: this app uses one SQLite file on disk, so it must run as exactly one machine — do not scale it horizontally (`min_machines_running` is already pinned to `1` in `fly.toml`). Also set the `TURN_*` secrets (see "Notes on calls" below) if you want calls to reliably connect for users on restrictive networks — without them, a small fraction of users may not be able to connect calls to each other, though chat/images/groups are unaffected.

## Deploying (Replit)

`.replit` and `replit.nix` are included so the project can be imported and deployed directly:

1. **Import from GitHub**: replit.com → **Create Repl** → **Import from GitHub** → paste this repo's URL.
2. Click **Run** once to confirm it starts (installs dependencies, starts on port 3000).
3. Click **Deploy** (Replit's publish step) and choose **Autoscale**.

If publishing still fails, the most common causes are:
- **Native module build failure** — `better-sqlite3` needs a C++ compiler. `replit.nix` installs `gcc`/`gnumake`/`python3` for this; if Replit ignores it, try **Tools → Shell** → `rm -rf node_modules && npm install` to force a rebuild inside Replit's own environment before deploying.
- **Data doesn't survive across separate Deployments** — Replit's Autoscale Deployments run in their own filesystem, separate from your workspace; `data/nexchat.db` and `data/uploads/` persist across restarts of that *same* deployment, but a full redeploy can reset them. This mirrors the same tradeoff as Render's free tier, just less often.

## Tech stack

- **Backend**: Node.js, Express, Socket.io, better-sqlite3, JWT (httpOnly cookie sessions), bcryptjs, multer (uploads)
- **Frontend**: Vanilla HTML/CSS/JS (no build step), native WebRTC APIs

## Project layout

```
server.js          Express app + Socket.io (realtime messaging, presence, WebRTC signaling)
db.js               SQLite schema/connection
auth.js              JWT cookie session helpers
routes/
  auth.js            register/login/logout/me/profile/user search
  chats.js            conversations, groups, members, message history
  upload.js           image/file upload endpoint
public/
  index.html          app shell (auth screen, chat UI, modals, call overlay)
  css/style.css        WhatsApp-style UI, light + dark theme
  js/i18n.js            EN/RU translation dictionary
  js/api.js             REST client
  js/webrtc.js           WebRTC call manager (mesh signaling for groups)
  js/app.js              UI logic, state, socket wiring
```

## Notes on calls

Calls use public STUN servers for NAT traversal by default, which is enough for most home WiFi and mobile connections. On restrictive corporate/school networks or symmetric-NAT mobile carriers, a **TURN relay** is required — STUN alone can't establish a path there, and the call will just hang on "Calling…".

To enable TURN, set these three environment variables (Fly.io: `fly secrets set NAME=value`; Replit: the Secrets tab) and redeploy — no code changes needed:

```
TURN_URLS=turn:your-turn-host:3478,turns:your-turn-host:5349
TURN_USERNAME=your-turn-username
TURN_CREDENTIAL=your-turn-password
```

The server exposes these at `/api/ice-servers` and the client fetches them automatically; when unset, it silently falls back to STUN-only.

Options for getting a TURN server:
- **Managed** (fastest to set up): Twilio Network Traversal Service, Cloudflare Realtime TURN, Metered.ca (has a free tier), or Xirsys — each gives you a URL + username + credential to drop into the env vars above.
- **Self-hosted**: run [coturn](https://github.com/coturn/coturn) on a small VM with a static IP and open UDP port range — cheaper at scale but more to maintain.
