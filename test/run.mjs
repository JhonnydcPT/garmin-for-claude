// Local test against a fake Garmin: node test/run.mjs
import worker from "../src/index.js";

const env = { GARMIN_API_KEY: "fake-key-123", ACCESS_CODE: "secret-code-1" };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const JWT = `${b64({ alg: "none" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 86400 })}.x`;
const calls = [];

globalThis.fetch = async (url, init = {}) => {
  calls.push([init.method || "GET", url, init.headers?.Authorization]);
  if (url.endsWith("/personal-api-key/token")) {
    return init.headers.Authorization === "ApiKey fake-key-123" ? new Response(JWT) : new Response("", { status: 401 });
  }
  if (init.headers?.Authorization !== "Bearer " + JWT) return new Response("", { status: 401 });
  if (url.includes("/activitylist-service/")) return new Response(JSON.stringify([{ activityId: 1, activityName: "Run", startTimeLocal: "2026-11-21 10:48:24" }]));
  if (url.includes("/hrv-service/hrv/daily/2026-11-01/2026-11-22")) return new Response(JSON.stringify({ hrvSummaries: [{ lastNightAvg: 47 }] }));
  return new Response("bad", { status: 400 });
};

const rpc = (body, code = env.ACCESS_CODE) =>
  worker.fetch(new Request(`https://x.workers.dev/mcp/${code}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), env);

let fail = 0;
const check = (name, cond) => { console.log((cond ? "OK  " : "FAIL") + "  " + name); if (!cond) fail++; };

let r = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
let j = await r.json();
check("initialize", j.result.protocolVersion === "2025-06-18" && j.result.capabilities.tools);
r = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
check("notification -> 202", r.status === 202);
j = await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
check("tools/list has 8 tools", j.result.tools.length === 8);
j = await (await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "garmin_hrv", arguments: { start: "2026-11-01", end: "2026-11-22" } } })).json();
check("garmin_hrv", j.result.content[0].text.includes("47") && !j.result.isError);
j = await (await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "garmin_hrv", arguments: { start: "1/11", end: "2026-11-22" } } })).json();
check("bad date -> isError", j.result.isError === true);
j = await (await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "garmin_get", arguments: { path: "//evil.com/x" } } })).json();
check("dangerous path blocked", j.result.isError === true);
const tokenCalls = calls.filter((c) => c[1].endsWith("/token")).length;
check("token reused (1 request only)", tokenCalls === 1);
r = await rpc({ jsonrpc: "2.0", id: 6, method: "tools/list" }, "wrong-code");
check("wrong code -> 404", r.status === 404);
r = await worker.fetch(new Request("https://x.workers.dev/test/secret-code-1"), env);
check("test page ok", r.status === 200 && (await r.text()).includes("Everything works"));
r = await worker.fetch(new Request("https://x.workers.dev/test/secret-code-1"), { ...env, GARMIN_API_KEY: "wrong" });
check("wrong key -> clear message", r.status === 502 && (await r.text()).includes("401"));
r = await worker.fetch(new Request("https://x.workers.dev/"), env);
check("home page", r.status === 200);
process.exit(fail ? 1 : 0);
