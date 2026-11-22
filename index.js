// Garmin for Claude — a minimal MCP connector for the Garmin Connect Personal API.
// One file, no dependencies. Read-only.
//
// Required secrets (set them when you deploy on Cloudflare):
//   GARMIN_API_KEY  the Personal API key you created in Garmin Connect
//   ACCESS_CODE     a secret code you choose: it is part of the URL you give to Claude

const GARMIN = "https://personal.connectapi.garmin.com";
const TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";
const SERVER_INFO = { name: "garmin-for-claude", version: "1.1.0" };
const MAX_CHARS = 60000;

// ---------------------------------------------------------------- Garmin token

let cached = null; // { token, exp, key }

function jwtExp(token) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(part + "===".slice((part.length + 3) % 4)));
    return typeof json.exp === "number" ? json.exp : 0;
  } catch {
    return 0;
  }
}

async function getToken(env, force = false) {
  const now = Math.floor(Date.now() / 1000);
  if (!force && cached && cached.key === env.GARMIN_API_KEY && cached.exp - now > 3600) {
    return cached.token;
  }
  const res = await fetch(GARMIN + TOKEN_PATH, {
    method: "POST",
    headers: { Authorization: "ApiKey " + env.GARMIN_API_KEY.trim(), Accept: "*/*" },
  });
  if (!res.ok) {
    throw new Error(
      res.status === 401
        ? "Garmin rejected the key (401): it is expired, deleted or was pasted incorrectly. Create a new one in Garmin Connect and update it on Cloudflare."
        : "Garmin did not return a token (HTTP " + res.status + ")."
    );
  }
  const token = (await res.text()).trim().replace(/^"|"$/g, "");
  cached = { token, exp: jwtExp(token) || now + 3600 * 20, key: env.GARMIN_API_KEY };
  return token;
}

async function garminGet(env, path) {
  let token = await getToken(env);
  let res = await fetch(GARMIN + path, {
    headers: { Authorization: "Bearer " + token, Accept: "application/json" },
  });
  if (res.status === 401) {
    token = await getToken(env, true);
    res = await fetch(GARMIN + path, {
      headers: { Authorization: "Bearer " + token, Accept: "application/json" },
    });
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      "Garmin answered HTTP " + res.status + " on " + path.split("?")[0] +
        (res.status === 400 ? " (wrong date or range too long: try fewer days)." : ".") +
        (text ? " " + text.slice(0, 300) : "")
    );
  }
  return text;
}

// ---------------------------------------------------------------- tools

const DATE = { type: "string", description: "Date in YYYY-MM-DD format" };
const RANGE = {
  type: "object",
  properties: {
    start: { ...DATE, description: "First day, YYYY-MM-DD" },
    end: { ...DATE, description: "Last day, YYYY-MM-DD (at most about 28 days after the start)" },
  },
  required: ["start", "end"],
};

const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const e = encodeURIComponent;

const TOOLS = [
  {
    name: "garmin_sleep",
    description: "Sleep for one night: duration, stages, score, heart rate and breathing. The date is the day you woke up.",
    inputSchema: { type: "object", properties: { date: DATE }, required: ["date"] },
    path: (a) => `/sleep-service/sleep/dailySleep?date=${e(a.date)}`,
    dates: ["date"],
  },
  {
    name: "garmin_hrv",
    description: "Overnight heart rate variability (HRV) day by day, with status (balanced, unbalanced...).",
    inputSchema: RANGE,
    path: (a) => `/hrv-service/hrv/daily/${e(a.start)}/${e(a.end)}`,
    dates: ["start", "end"],
  },
  {
    name: "garmin_body_battery",
    description: "Body Battery day by day: charged, drained, highest and lowest value.",
    inputSchema: RANGE,
    path: (a) => `/wellness-service/wellness/bodyBattery/reports/daily?startDate=${e(a.start)}&endDate=${e(a.end)}`,
    dates: ["start", "end"],
  },
  {
    name: "garmin_daily_summary",
    description: "Summary of each day: steps, calories, resting heart rate, stress, intensity minutes.",
    inputSchema: RANGE,
    path: (a) => `/usersummary-service/v2/dailysummaries?startDate=${e(a.start)}&endDate=${e(a.end)}`,
    dates: ["start", "end"],
  },
  {
    name: "garmin_weight",
    description: "Weigh-ins in the period (weight and, with a smart scale, body composition).",
    inputSchema: RANGE,
    path: (a) => `/weight-service/weight/range/${e(a.start)}/${e(a.end)}?includeAll=true`,
    dates: ["start", "end"],
  },
  {
    name: "garmin_activities",
    description: "List of recent activities (workouts) with type, duration, distance, heart rate and ID. Use garmin_activity_details for the full data.",
    inputSchema: {
      type: "object",
      properties: {
        count: { type: "integer", description: "How many activities (1-50, default 10)" },
        start: { ...DATE, description: "Optional: only activities from this day" },
        end: { ...DATE, description: "Optional: only activities up to this day" },
      },
    },
    path: (a) => {
      const n = Math.min(Math.max(parseInt(a.count ?? 10, 10) || 10, 1), 50);
      let p = `/activitylist-service/activities/search/activities?start=0&limit=${n}`;
      if (a.start) p += `&startDate=${e(a.start)}`;
      if (a.end) p += `&endDate=${e(a.end)}`;
      return p;
    },
    dates: [],
    optionalDates: ["start", "end"],
  },
  {
    name: "garmin_activity_details",
    description: "All the details of one activity (heart rate, zones, pace, power, running dynamics, load). Needs the ID from garmin_activities.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Numeric activity ID" } },
      required: ["id"],
    },
    path: (a) => {
      if (!/^\d+$/.test(String(a.id))) throw new Error("The activity ID must be a number.");
      return `/activity-service/activity/${a.id}`;
    },
    dates: [],
  },
  {
    name: "garmin_get",
    description: "For experts: GET any other Garmin Personal API endpoint (e.g. /hrv-service/hrv/2026-11-22). Read-only.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Path starting with /, with optional ?a=b parameters" } },
      required: ["path"],
    },
    path: (a) => {
      const p = String(a.path || "");
      if (!p.startsWith("/") || p.startsWith("//") || p.includes("..")) throw new Error("The path must start with /");
      return p;
    },
    dates: [],
  },
];

async function callTool(env, name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error("Unknown tool: " + name);
  args = args || {};
  for (const k of tool.dates) if (!isDate(args[k])) throw new Error(`"${k}" must be a YYYY-MM-DD date.`);
  for (const k of tool.optionalDates || []) if (args[k] && !isDate(args[k])) throw new Error(`"${k}" must be a YYYY-MM-DD date.`);
  let text = await garminGet(env, tool.path(args));
  if (!text) text = "(no data for this period)";
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS) + "\n...[response cut: ask for a shorter period]";
  }
  return text;
}

// ---------------------------------------------------------------- MCP protocol

async function handleRpc(env, msg) {
  const { id, method, params } = msg || {};
  const isNotification = id === undefined || id === null;
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const err = (code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

  if (!msg || msg.jsonrpc !== "2.0" || typeof method !== "string") return err(-32600, "Invalid request");
  if (isNotification) return null;

  switch (method) {
    case "initialize":
      return ok({
        protocolVersion: params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions:
          "Read-only access to the user's Garmin data. Dates are YYYY-MM-DD. For long periods make several calls of at most 28 days.",
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({
        tools: TOOLS.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
          annotations: { readOnlyHint: true, openWorldHint: true },
        })),
      });
    case "tools/call":
      try {
        const text = await callTool(env, params?.name, params?.arguments);
        return ok({ content: [{ type: "text", text }] });
      } catch (x) {
        return ok({ content: [{ type: "text", text: String(x.message || x) }], isError: true });
      }
    default:
      return err(-32601, "Method not supported: " + method);
  }
}

// ---------------------------------------------------------------- HTTP

function sameCode(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });

const html = (body, status = 200) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Garmin for Claude</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px">${body}</body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );

const connectHelp = (origin) =>
  `<h2>Connect it to Claude</h2><p>In Claude: <b>Settings → Connectors → Add custom connector</b>.</p><ul><li><b>URL:</b> <code>${origin}/mcp/YOUR-ACCESS-CODE</code></li><li><b>Authentication:</b> No sign in</li></ul><p>Keep this URL secret: it contains your code.</p>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["test", "<code>"] or ["mcp"]

    if (parts.length === 0) {
      const ready = Boolean(env.GARMIN_API_KEY && env.ACCESS_CODE);
      return html(
        ready
          ? `<h1>✅ Garmin for Claude is running</h1><p>To check your Garmin key open:<br><code>${url.origin}/test/YOUR-ACCESS-CODE</code></p>${connectHelp(url.origin)}`
          : `<h1>⚠️ Setup missing</h1><p>On Cloudflare add the secrets <code>GARMIN_API_KEY</code> and <code>ACCESS_CODE</code>.</p>`
      );
    }

    if (!env.ACCESS_CODE || String(env.ACCESS_CODE).length < 8) {
      return html("<h1>⚠️ ACCESS_CODE is missing or too short (at least 8 characters)</h1>", 500);
    }
    const code = String(env.ACCESS_CODE);
    const isTest = parts[0] === "test" && parts.length === 2 && sameCode(parts[1], code);
    // MCP: code in a request header (recommended) or, for older setups, in the URL.
    const headerCode =
      request.headers.get("x-access-code") ||
      (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const isMcp =
      parts[0] === "mcp" &&
      ((parts.length === 1 && sameCode(headerCode.trim(), code)) || (parts.length === 2 && sameCode(parts[1], code)));
    if (!isTest && !isMcp) {
      return new Response("Not found", { status: 404 });
    }

    if (isTest) {
      try {
        await getToken(env, true);
        const list = JSON.parse(await garminGet(env, "/activitylist-service/activities/search/activities?start=0&limit=1"));
        const last = Array.isArray(list) && list[0] ? `Latest activity: <b>${list[0].activityName || "untitled"}</b> on ${String(list[0].startTimeLocal || "").slice(0, 10)}.` : "";
        return html(`<h1>✅ Everything works</h1><p>Your Garmin key is valid. ${last}</p>${connectHelp(url.origin)}`);
      } catch (x) {
        return html(`<h1>❌ Something is wrong</h1><p>${String(x.message || x)}</p>`, 502);
      }
    }

    // MCP endpoint
    if (request.method === "GET") return new Response("Use POST (MCP Streamable HTTP).", { status: 405, headers: { Allow: "POST" } });
    if (request.method === "DELETE") return new Response(null, { status: 204 });
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON" } }, 400);
    }

    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map((m) => handleRpc(env, m)))).filter(Boolean);
      return out.length ? json(out) : new Response(null, { status: 202 });
    }
    const out = await handleRpc(env, body);
    return out ? json(out) : new Response(null, { status: 202 });
  },
};
