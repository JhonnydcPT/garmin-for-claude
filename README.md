# Garmin for Claude ⌚🤖

Connect your Garmin data (sleep, HRV, Body Battery, weight, workouts) to Claude **in 3 steps**, with nothing to install on your computer.

It works from your phone and with your computer off. It is read-only: it never changes anything in your Garmin account.

**Zero cost:** free Claude (which allows 1 custom connector), free Garmin Connect and free Cloudflare are enough.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/JhonnydcPT/garmin-for-claude)

---

## Step 1 · Create your Garmin key (2 minutes)

1. On a computer, open **[connect.garmin.com/app/settings/personalApiToken](https://connect.garmin.com/app/settings/personalApiToken)** and sign in with your Garmin account.
2. Click **Create**, accept the terms and pick the longest duration (**1 year**).
3. **Copy the key** and keep it safe: Garmin shows it only once.

> Never send the key to anyone, never paste it into a chat and never put it in a file on GitHub.

## Step 2 · Put your connector online (3 minutes)

1. Click the orange **Deploy to Cloudflare** button above.
2. Sign in to Cloudflare, or create a free account.
3. When it asks for the secrets, fill in the two fields:
   - **GARMIN_API_KEY** → paste the key from step 1;
   - **ACCESS_CODE** → make up a secret code of **at least 12 characters, no spaces** (for example `run-fast-2026-xyz`). It is your connector's password: write it down.
4. Click **Deploy** and wait until it finishes.
5. Check that it works: open in your browser
   `https://garmin-for-claude.<your-subdomain>.workers.dev/test/<your-ACCESS_CODE>`
   If you see **✅ Everything works**, step 2 is done. You can find the exact URL of your connector on Cloudflare, on the page of the Worker you just created.

<details>
<summary>Cloudflare did not ask me for the secrets</summary>

On Cloudflare open **Workers & Pages → garmin-for-claude → Settings → Variables and Secrets**. Click **Add**, choose the type **Secret** and create `GARMIN_API_KEY` and `ACCESS_CODE`. Then run the check in point 5 again.
</details>

## Step 3 · Connect it to Claude (1 minute)

1. On **claude.ai** open **Settings → Connectors → Add custom connector**.
2. Name: `Garmin`. URL:
   `https://garmin-for-claude.<your-subdomain>.workers.dev/mcp`
3. Authentication: choose **No sign in**.
4. Under **Request headers** add one header:
   - name: `X-Access-Code`
   - value: your `ACCESS_CODE`
5. Click **Add**. The connector also works in the Claude app on your phone.

Your secret code travels in the header, not in the URL, so the URL is safe to show (for example in a video).

<details>
<summary>My Claude has no "Request headers" field</summary>

Put the code at the end of the URL instead: `https://garmin-for-claude.<your-subdomain>.workers.dev/mcp/<your-ACCESS_CODE>`. In this case the URL itself is secret: don't share it.
</details>

Now ask Claude, for example:

- *"How did I sleep last night?"*
- *"How has my HRV been over the last 2 weeks?"*
- *"Analyze my last run."*
- *"Compare this week's steps and Body Battery with last week."*

---

## What Claude can read

| Tool | What it returns |
|---|---|
| `garmin_sleep` | One night of sleep: duration, stages and score |
| `garmin_hrv` | Overnight HRV day by day |
| `garmin_body_battery` | Body Battery day by day |
| `garmin_daily_summary` | Steps, calories, resting heart rate and stress |
| `garmin_weight` | Weigh-ins |
| `garmin_activities` | List of recent workouts |
| `garmin_activity_details` | All the data of one workout |
| `garmin_get` | For experts: any other Personal API endpoint |

## Good to know

- **Training Readiness, Training Status and VO2max are not available:** Garmin's Personal API does not provide them.
- **The Garmin key expires** (after 1 year at most), and Garmin emails you about a week before. When it happens, create a new one (step 1) and replace it on Cloudflare in Settings → Variables and Secrets.
- **Your ACCESS_CODE works like a password:** anyone who has it can read your Garmin data, so don't share it. If you think someone knows it, change `ACCESS_CODE` on Cloudflare and update it in Claude.
- **The connector is yours only.** The Garmin key is for personal use: everyone must deploy their own copy with their own key.
- **This is a free personal project**, not official and not affiliated with Garmin or Anthropic.

## For developers

A single file, `src/index.js`, with no dependencies. The MCP server uses Streamable HTTP in stateless mode. The key is exchanged for a token with `POST /personalapitoken-service/personal-api/personal-api-key/token` and `Authorization: ApiKey …`; the token lasts 24 hours and is cached in memory.

```bash
npm test                         # tests against a fake Garmin
npx wrangler secret put GARMIN_API_KEY
npx wrangler secret put ACCESS_CODE
npx wrangler deploy
```

MIT License.
