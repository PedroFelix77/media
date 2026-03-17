const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { config } = require('../config');
const { logger } = require('../logger');
const { createRoomWithGeneratedId, createRoom, closeRoom, listRooms } = require('../rooms/rooms');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

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

  app.use(express.static(PUBLIC_DIR));

  app.get('/', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  // Sala geral: ID fixo para todo mundo entrar na mesma sala
  const SALA_GERAL_ID = 'geral';

  // Demo: obter token para entrar na sala (cria sala se não existir)
  app.post('/demo/token', limiter, async (req, res) => {
    try {
      const roomId = req.body && String(req.body.roomId || '').trim();
      const userId = req.body && String(req.body.userId || req.body.userName || 'user').trim() || 'user';
      const idToUse = roomId || SALA_GERAL_ID;
      const room = await createRoom(idToUse);
      const callId = room.id;
      const token = jwt.sign(
        { roomId: room.id, userId, callId, role: 'user' },
        config.auth.jwtSecret,
        { algorithm: 'HS256', expiresIn: '24h' }
      );
      const wsUrl = config.ws.url || `ws://${req.hostname}:${config.ws.port}`;
      logger.info({ roomId: room.id, userId }, 'DEMO_TOKEN');
      return res.json({ token, wsUrl, roomId: room.id });
    } catch (err) {
      logger.warn({ err }, 'Erro ao gerar token demo');
      return res.status(500).json({ error: 'token_failed', message: err.message });
    }
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

