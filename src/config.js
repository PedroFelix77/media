const os = require('node:os');

function envInt(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return n;
}

function envStr(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function envBool(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes';
}

const config = {
  nodeId: envStr('SFU_NODE_ID', os.hostname()),

  http: {
    port: envInt('SFU_HTTP_PORT', 3000),
    apiSecret: envStr('SFU_API_SECRET', ''),
    rateLimit: {
      windowMs: envInt('SFU_API_RATE_LIMIT_WINDOW_MS', 60_000),
      max: envInt('SFU_API_RATE_LIMIT_MAX', 10)
    }
  },

  ws: {
    port: envInt('SFU_WS_PORT', 4443),
    heartbeatIntervalMs: envInt('SFU_WS_HEARTBEAT_INTERVAL_MS', 10_000),
    heartbeatTimeoutMs: envInt('SFU_WS_HEARTBEAT_TIMEOUT_MS', 30_000)
  },

  auth: {
    jwtSecret: envStr('SFU_JWT_SECRET', '')
  },

  mediasoup: {
    numWorkers: envInt('SFU_NUM_WORKERS', os.cpus().length),
    rtcMinPort: envInt('SFU_RTC_MIN_PORT', 40000),
    rtcMaxPort: envInt('SFU_RTC_MAX_PORT', 49999),

    listenIp: envStr('SFU_LISTEN_IP', '0.0.0.0'),
    announcedIp: envStr('SFU_ANNOUNCED_IP', ''),

    maxIncomingBitrate: envInt('SFU_MAX_INCOMING_BITRATE', 1_500_000),

    // Codecs padrão (VP8 + Opus). Ajuste conforme necessidade do frontend.
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {}
      }
    ]
  },

  rooms: {
    emptyGraceMs: envInt('SFU_ROOM_EMPTY_GRACE_MS', 30_000)
  },

  // ICE servers são normalmente configurados no cliente WebRTC (RTCPeerConnection).
  // Mantemos aqui como referência para eventualmente expor ao frontend via sinalização, se necessário.
  ice: {
    enabled: envBool('SFU_ICE_ENABLED', true),
    stunUrl: envStr('SFU_STUN_URL', 'stun:stun.l.google.com:19302'),
    turnUrl: envStr('SFU_TURN_URL', ''),
    turnUsername: envStr('SFU_TURN_USERNAME', ''),
    turnCredential: envStr('SFU_TURN_CREDENTIAL', '')
  }
};

module.exports = { config };

