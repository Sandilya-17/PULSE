# Deploy Pulse on Railway — exact commands

Run these in a terminal (Mac/Linux). Requires Node.js. You get a free HTTPS link like `https://pulse-production-xxxx.up.railway.app`.

```bash
# 1. Install the Railway CLI and log in (opens your browser)
npm i -g @railway/cli
railway login

# 2. Go into the project folder
cd pulse-fullstack

# 3. Create the project (choose "Empty Project" when asked, name it: pulse)
railway init

# 4. Add the PostgreSQL database
railway add --database postgres

# 5. Add the app service
railway add --service pulse

# 6. Set the variables (single quotes are important)
railway variables --service pulse --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}'
railway variables --service pulse --set 'NODE_ENV=production'
railway variables --service pulse --set "JWT_SECRET=$(openssl rand -hex 32)"

# 7. Deploy (takes ~2-4 minutes)
railway up --service pulse

# 8. Get your public link
railway domain --service pulse
```
Open the link it prints. Done. Check logs any time with `railway logs --service pulse`.

If a command says an option isn't recognised, your CLI version differs: run `railway add --help` (or `railway variables --help`) and use the equivalent flag, or do the same step in the Railway dashboard (railway.com → your project).

## Optional upgrades (set the same way: `railway variables --service pulse --set 'NAME=value'`)

**Calls on mobile data / different networks (recommended):** Railway can't host a TURN relay (no UDP), so use a hosted one. Create a free account at metered.ca, make a TURN app, then:
```bash
railway variables --service pulse --set 'TURN_URL=turn:global.relay.metered.ca:80,turn:global.relay.metered.ca:443,turns:global.relay.metered.ca:443?transport=tcp'
railway variables --service pulse --set 'TURN_USERNAME=<username from metered>'
railway variables --service pulse --set 'TURN_CREDENTIAL=<credential from metered>'
```
**Push notifications:**
```bash
npx web-push generate-vapid-keys        # copy the two keys it prints
railway variables --service pulse --set 'VAPID_PUBLIC=<public key>'
railway variables --service pulse --set 'VAPID_PRIVATE=<private key>'
railway variables --service pulse --set 'VAPID_SUBJECT=mailto:you@example.com'
```
**Custom domain:** `railway domain chat.yourcompany.com` then add the DNS record it shows.

## Update the live app after changes
```bash
railway up --service pulse
```

## Talking to your friends
1. Send them your Railway link.
2. Everyone taps **Create account** and picks a unique @username.
3. Search a friend's username (Search tab) → **Chat**. Messages arrive instantly; 📞 = voice call, 🎥 = video call. Make a group with **+ New group** and type usernames separated by commas.
4. Install it like an app: iPhone — Safari → Share → Add to Home Screen (needed for iPhone push); Android — Chrome → ⋮ → Install app.
5. For notifications: Me tab → 🔔 Notifications (needs the VAPID variables above).
