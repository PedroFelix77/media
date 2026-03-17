const express = require('express');
const rateLimit = require('express-rate-limit');
const { config } = require('../config');
const { logger } = require('../logger');
const { createRoomWithGeneratedId, createRoom, closeRoom, listRooms } = require('../rooms/rooms');

function requireApiAuth(req, res, next) {
  const auth = req.header('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
  if (!token || token !== config.http.apiSecret) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
}

async function startHttpServer() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  const limiter = rateLimit({
    windowMs: config.http.rateLimit.windowMs,
    limit: config.http.rateLimit.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false
  });

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Métricas simples (JSON) - pode ser adaptado para Prometheus no futuro.
  app.get('/metrics', requireApiAuth, (_req, res) => {
    const rooms = listRooms();
    const peers = rooms.reduce((sum, r) => sum + (r.peers || 0), 0);
    res.json({
      rooms_active: rooms.length,
      peers_active: peers,
      rooms
    });
  });

  // Somente para debug operacional (proteger via auth).
  app.get('/rooms', requireApiAuth, (_req, res) => {
    res.json({ rooms: listRooms() });
  });

  // create-room (rate limited)
  app.post('/rooms', limiter, requireApiAuth, async (req, res) => {
    const { roomId, callId } = req.body || {};

    try {
      const room = roomId ? await createRoom(String(roomId)) : await createRoomWithGeneratedId();
      logger.info({ roomId: room.id, callId: callId ? String(callId) : undefined }, 'API_CREATE_ROOM');
      return res.json({
        room_id: room.id,
        sfu_node: config.nodeId
      });
    } catch (err) {
      logger.warn({ err }, 'Erro ao criar room');
      return res.status(500).json({ error: 'create_room_failed' });
    }
  });

  // destroy-room
  app.delete('/rooms/:roomId', requireApiAuth, async (req, res) => {
    const roomId = String(req.params.roomId);
    try {
      const ok = await closeRoom(roomId);
      return res.json({ ok });
    } catch (err) {
      logger.warn({ err, roomId }, 'Erro ao destruir room');
      return res.status(500).json({ error: 'destroy_room_failed' });
    }
  });

  const server = app.listen(config.http.port, () => {
    logger.info({ httpPort: config.http.port }, 'HTTP iniciado');
  });

  return server;
}

module.exports = { startHttpServer };

