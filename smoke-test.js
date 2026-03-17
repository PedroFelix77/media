require("dotenv").config();

// Node 18+ já traz fetch global. Se não tiver, falha de forma explícita
if (typeof fetch !== "function") {
  // eslint-disable-next-line no-console
  console.error(
    "[smoke] Este script exige Node 18+ (fetch global). Atualize o Node.",
  );
  process.exit(1);
}

// Configuração / defaults
const httpPort = Number(process.env.SFU_HTTP_PORT || 3000);
const wsPort = Number(process.env.SFU_WS_PORT || 4443);
const apiSecret = process.env.SFU_API_SECRET || "";

const baseHttp = `http://127.0.0.1:${httpPort}`;
const baseWs = `ws://127.0.0.1:${wsPort}`;

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function c(color, msg) {
  return `${COLORS[color]}${msg}${COLORS.reset}`;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function parseCliArgs(argv) {
  const args = {
    verbose: false,
    timeoutMs: 8000,
    skipWs: false,
  };

  for (const raw of argv.slice(2)) {
    if (raw === "--verbose" || raw === "-v") args.verbose = true;
    else if (raw === "--skip-ws") args.skipWs = true;
    else if (raw.startsWith("--timeout=")) {
      const v = Number(raw.split("=", 2)[1]);
      if (!Number.isNaN(v) && v > 0) args.timeoutMs = v;
    }
  }

  return args;
}

async function httpGet(path, headers = {}, { verbose } = {}) {
  const url = `${baseHttp}${path}`;
  if (verbose) console.log(c("cyan", `[http] GET ${url}`));

  const res = await fetch(url, { headers });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // corpo não-JSON é aceitável, mantemos text
  }
  return {
    res,
    text,
    json,
  };
}

async function httpPost(path, body, headers = {}, { verbose } = {}) {
  const url = `${baseHttp}${path}`;
  if (verbose)
    console.log(
      c("cyan", `[http] POST ${url} body=${JSON.stringify(body ?? {})}`),
    );

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // idem GET
  }
  return { res, text, json };
}

function wsConnect(url, { verbose } = {}) {
  const WS = globalThis.WebSocket || require("ws");
  if (verbose) console.log(c("cyan", `[ws] conectando em ${url}`));
  return new WS(url);
}

async function wsRequest(ws, payload, timeoutMs, { verbose } = {}) {
  const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const msg = { id, ...payload };

  if (verbose)
    console.log(
      c("cyan", `[ws] -> ${JSON.stringify({ ...msg, token: !!msg.token })}`),
    );

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
      if (verbose)
        console.log(c("cyan", `[ws] <- ${JSON.stringify(data)}`));
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

async function runHttpChecks(ctx) {
  const { verbose } = ctx;

  const health = await httpGet("/health", {}, { verbose });
  assert(health.res.status === 200, `GET /health status ${health.res.status}`);
  assert(
    health.json && health.json.ok === true,
    `GET /health payload inválido: ${health.text}`,
  );
  console.log(c("green", "[ok] /health"));

  const metricsNoAuth = await httpGet("/metrics", {}, { verbose });
  assert(
    metricsNoAuth.res.status === 401,
    `GET /metrics sem auth deveria ser 401, veio ${metricsNoAuth.res.status}`,
  );
  console.log(c("green", "[ok] /metrics sem auth -> 401"));
}

async function runProtectedEndpoints(ctx) {
  const { verbose } = ctx;

  assert(
    apiSecret,
    "SFU_API_SECRET vazio. Configure no .env para testar endpoints protegidos.",
  );

  const createRoom = await httpPost(
    "/rooms",
    { roomId: `test_${Date.now()}` },
    { authorization: `Bearer ${apiSecret}` },
    { verbose },
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
  console.log(c("green", `[ok] /rooms criou room_id=${roomId}`));

  const demo = await httpPost(
    "/demo/token",
    { roomId, userId: "smoke_user" },
    {},
    { verbose },
  );
  assert(
    demo.res.status === 200,
    `POST /demo/token status ${demo.res.status}: ${demo.text}`,
  );
  assert(
    demo.json && demo.json.token,
    `POST /demo/token payload inválido: ${demo.text}`,
  );
  console.log(c("green", "[ok] /demo/token gerou token"));

  return { roomId, demoToken: demo.json.token, wsUrl: demo.json.wsUrl };
}

async function runWsFlow(ctx, { wsUrl, demoToken }) {
  const { verbose, timeoutMs } = ctx;
  const url = wsUrl || baseWs;
  const ws = wsConnect(url, { verbose });

  await new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error("WS open timeout")),
      timeoutMs,
    );
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

  const joinResp = await wsRequest(
    ws,
    {
      action: "join",
      token: demoToken,
    },
    timeoutMs,
    { verbose },
  );
  assert(joinResp.ok === true, `WS join falhou: ${JSON.stringify(joinResp)}`);
  assert(
    joinResp.data && joinResp.data.peerId,
    `WS join sem peerId: ${JSON.stringify(joinResp)}`,
  );
  console.log(
    c("green", `[ok] WS join peerId=${joinResp.data.peerId}`),
  );

  const capsResp = await wsRequest(
    ws,
    { action: "getRouterRtpCapabilities" },
    timeoutMs,
    { verbose },
  );
  assert(
    capsResp.ok === true,
    `getRouterRtpCapabilities falhou: ${JSON.stringify(capsResp)}`,
  );
  console.log(c("green", "[ok] WS getRouterRtpCapabilities"));

  const leaveResp = await wsRequest(
    ws,
    { action: "leave" },
    timeoutMs,
    { verbose },
  );
  assert(
    leaveResp.ok === true,
    `WS leave falhou: ${JSON.stringify(leaveResp)}`,
  );
  console.log(c("green", "[ok] WS leave"));

  try {
    ws.close?.();
  } catch {
    // ignore
  }
}

async function main() {
  const args = parseCliArgs(process.argv);

  console.log(
    c(
      "yellow",
      `[smoke] HTTP: ${baseHttp}  WS: ${baseWs}  timeout=${args.timeoutMs}ms`,
    ),
  );

  await runHttpChecks(args);

  const { demoToken, wsUrl } = await runProtectedEndpoints(args);

  if (args.skipWs) {
    console.log(
      c("yellow", "[smoke] --skip-ws ativo, não executando fluxo WS"),
    );
  } else {
    await runWsFlow(args, { wsUrl, demoToken });
  }

  console.log(c("green", "\n[smoke] PASSOU"));
}

main().catch((err) => {
  console.error(
    c(
      "red",
      `\n[smoke] FALHOU: ${
        err && err.stack ? err.stack : String(err || "erro desconhecido")
      }`,
    ),
  );
  process.exitCode = 1;
});
