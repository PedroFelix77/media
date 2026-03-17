require("dotenv").config();
const httpPort = Number(process.env.SFU_HTTP_PORT || 3000);
const wsPort = Number(process.env.SFU_WS_PORT || 4443);
const apiSecret = process.env.SFU_API_SECRET || "";

const baseHttp = `http://127.0.0.1:${httpPort}`;
const baseWs = `ws://127.0.0.1:${wsPort}`;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function httpGet(path, headers = {}) {
  const res = await fetch(`${baseHttp}${path}`, { headers });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return {
    res,
    text,
    json,
  };
}

async function httpPost(path, body, headers = {}) {
  const res = await fetch(`${baseHttp}${path} `, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { res, text, json };
}

function wsConnect(url) {
  const WS = globalThis.WebSocket || require("ws");
  return new WS(url);
}

async function wsRequest(ws, payload, timeoutMs = 5000) {
  const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const msg = { id, ...payload };

  return await new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`WS timeout (${payload.action})`)),
      timeoutMs,
    );

    function onMessage(raw) {
      let data;
      try {
        data = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (data && data.action === "ping") {
        ws.send(JSON.stringify({ action: "pong" }));
        return;
      }

      if (!data || data.id !== id) return;

      cleanup();
      resolve(data);
    }

    function onError(err) {
      cleanup();
      reject(err);
    }

    function cleanup() {
      clearTimeout(t);
      ws.removeEventListener?.("message", onMessage);
      ws.removeEventListener?.("error", onError);
      ws.off?.("message", onMessage);
      ws.off?.("error", onError);
    }

    if (ws.addEventListener) {
      ws.addEventListener("message", (ev) => onMessage(ev.data));
      ws.addEventListener("error", onError);
    } else {
      ws.on("message", onMessage);
      ws.on("error", onError);
    }

    ws.send(JSON.stringify(msg));
  });
}

async function main() {
  console.log(`[smoke] HTTP: ${baseHttp}`);
  console.log(`[smoke] WS:   ${baseWs}`);

  const health = await httpGet("/health");
  assert(health.res.status === 200, `GET /health status ${health.res.status}`);
  assert(
    health.json && health.json.ok === true,
    `GET /health payload inválido: ${health.text}`,
  );
  console.log("[ok] /health");

  const metricsNoAuth = await httpGet("/metrics");
  assert(
    metricsNoAuth.res.status === 401,
    `GET /metrics sem auth deveria ser 401, veio ${metricsNoAuth.res.status}`,
  );
  console.log("[ok] /metrics sem auth -> 401");

  assert(
    apiSecret,
    "SFU_API_SECRET vazio. Configure no .env para testar endpoints protegidos.",
  );

  const createRoom = await httpPost(
    "/rooms",
    { roomId: `test_${Date.now()}` },
    { authorization: `Bearer ${apiSecret}` },
  );
  assert(
    createRoom.res.status === 200,
    `POST /rooms status ${createRoom.res.status}: ${createRoom.text}`,
  );
  assert(
    createRoom.json && createRoom.json.room_id,
    `POST /rooms payload inválido: ${createRoom.text}`,
  );
  const roomId = createRoom.json.room_id;
  console.log(`[ok] /rooms criou room_id=${roomId}`);

  const demo = await httpPost("/demo/token", { roomId, userId: "smoke_user" });
  assert(
    demo.res.status === 200,
    `POST /demo/token status ${demo.res.status}: ${demo.text}`,
  );
  assert(
    demo.json && demo.json.token,
    `POST /demo/token payload inválido: ${demo.text}`,
  );
  console.log("[ok] /demo/token gerou token");

  const wsUrl = demo.json.wsUrl || baseWs;
  const ws = wsConnect(wsUrl);

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("WS open timeout")), 5000);
    function ok() {
      clearTimeout(t);
      resolve();
    }
    function bad(err) {
      clearTimeout(t);
      reject(err);
    }

    if (ws.addEventListener) {
      ws.addEventListener("open", ok);
      ws.addEventListener("error", bad);
    } else {
      ws.on("open", ok);
      ws.on("error", bad);
    }
  });

  const joinResp = await wsRequest(ws, {
    action: "join",
    token: demo.json.token,
  });
  assert(joinResp.ok === true, `WS join falhou: ${JSON.stringify(joinResp)}`);
  assert(
    joinResp.data && joinResp.data.peerId,
    `WS join sem peerId: ${JSON.stringify(joinResp)}`,
  );
  console.log(`[ok] WS join peerId=${joinResp.data.peerId}`);

  const capsResp = await wsRequest(ws, { action: "getRouterRtpCapabilities" });
  assert(
    capsResp.ok === true,
    `getRouterRtpCapabilities falhou: ${JSON.stringify(capsResp)}`,
  );
  console.log("[ok] WS getRouterRtpCapabilities");

  const leaveResp = await wsRequest(ws, { action: "leave" });
  assert(
    leaveResp.ok === true,
    `WS leave falhou: ${JSON.stringify(leaveResp)}`,
  );
  console.log("[ok] WS leave");

  try {
    ws.close?.();
  } catch {}
  console.log("\n[smoke] PASSOU");
}

main().catch((err) => {
  console.error("\n[smoke] FALHOU:", err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
