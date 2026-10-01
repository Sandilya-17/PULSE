# Pulse — secure real-time messaging & calls

**Deploying? Follow `DEPLOY.md` (Railway, copy-paste commands).** The VPS/Docker option lives in `vps/`.

React (Vite) · Node/Express · Socket.IO · PostgreSQL · JWT · WebRTC · Web Push · WebCrypto E2EE · S3 uploads · coturn · Caddy HTTPS

## Local dev
```bash
docker compose up -d                          # PostgreSQL
cp .env.example server/.env                   # optional: fill in what you want to test
cd server && npm install && npm start         # API + sockets :4000
cd client && npm install && npm run dev       # https://localhost:5173 (self-signed HTTPS; works on phone via LAN IP)
```
Accept the browser's self-signed certificate warning once. HTTPS is what enables camera/mic and push on non-localhost devices.

## Production (one server, one command)
```bash
cp .env.example .env     # fill DOMAIN, PUBLIC_IP, secrets, TURN_*, VAPID_*, S3_*
docker compose -f vps/docker-compose.prod.yml up -d --build
```
Point your domain's DNS at the server; Caddy issues the HTTPS certificate automatically. Open ports 80, 443, 3478 (UDP+TCP) and 49160-49200 (UDP).
Railway/Render also work for the app+Postgres (use the Dockerfile) but TURN needs a VM (or a hosted TURN service: set `TURN_URL` + `TURN_SECRET` accordingly).

## What's included
- Accounts by @username, bcrypt + JWT
- 1:1 + group chats, image/file messages, typing, online, read receipts (✓ / blue ✓✓), unread badges
- **Calls**: voice/video, 1:1 and **group (up to 6, mesh)**. Tap 📞/🎥 in any chat; others get a ring + push notification.
- **TURN**: ephemeral credentials issued by `/api/ice` (coturn included) — calls work across networks / mobile data
- **HTTPS**: Caddy in production, self-signed in dev
- **Uploads**: S3-compatible bucket when `S3_*` is set, otherwise local disk
- **Push notifications**: Web Push (VAPID). Me tab → 🔔 Notifications. Sent when the user is offline: new message + incoming call
- **End-to-end encryption** (1:1 text): ECDH P-256 + AES-GCM in the browser; the private key never leaves the device (non-extractable, IndexedDB); the server stores only ciphertext
- Instagram side: follow, feed, likes, comments, 24h stories

## Honest limits
- E2EE covers **1:1 message text only**: not group chats, not attachments, not metadata. Keys are per-device: logging in on a new device/browser cannot read old encrypted messages. Calls are WebRTC (DTLS-SRTP encrypted peer-to-peer or via TURN).
- Group calls are a mesh (each person connects to each other), so keep it ≤6. For bigger rooms use an SFU (LiveKit/mediasoup).
- Push on iPhone requires adding the site to the Home Screen (iOS 16.4+).
- S3 bucket must allow public reads (or put a CDN in front).
