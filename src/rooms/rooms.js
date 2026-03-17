const { randomUUID } = require('node:crypto');
const { createRouterForRoom } = require('../mediasoup/workers');
const { logger } = require('../logger');

/**
 * Estrutura em memória:
 * roomId => { id, router, workerPid, peers: Map, createdAt }
 *
 * 1 router por room (arquitetura recomendada MediaSoup).
 */
const rooms = new Map();

function makeRoomId() {
  return `room_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function cancelAutoClose(room) {
  if (room.__emptyTimer) {
    clearTimeout(room.__emptyTimer);
    room.__emptyTimer = null;
  }
}

function scheduleAutoCloseIfEmpty(room, graceMs) {
  if (room.peers.size !== 0) return;
  if (room.__emptyTimer) return;

  room.__emptyTimer = setTimeout(async () => {
    room.__emptyTimer = null;
    if (room.peers.size === 0) {
      await closeRoom(room.id);
    }
  }, graceMs);
}

async function createRoom(roomId) {
  if (rooms.has(roomId)) return rooms.get(roomId);

  const { router, workerPid } = await createRouterForRoom();
  const room = {
    id: roomId,
    router,
    workerPid,
    peers: new Map(),
    createdAt: Date.now(),
    __emptyTimer: null
  };

  rooms.set(roomId, room);

  logger.info(
    { roomId, workerPid },
    'ROOM_CREATED'
  );

  return room;
}

async function createRoomWithGeneratedId() {
  let roomId = makeRoomId();
  while (rooms.has(roomId)) roomId = makeRoomId();
  return createRoom(roomId);
}

function getRoom(roomId) {
  return rooms.get(roomId) || null;
}

function listRooms() {
  return Array.from(rooms.values()).map((r) => ({
    roomId: r.id,
    workerPid: r.workerPid,
    peers: r.peers.size,
    createdAt: r.createdAt
  }));
}

async function closeRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return false;

  cancelAutoClose(room);

  // Fechar peers antes do router.
  for (const peer of room.peers.values()) {
    try {
      peer.close('room_closed');
    } catch (e) {
      logger.warn({ err: e, roomId, peerId: peer.id }, 'Erro ao fechar peer');
    }
  }

  try {
    room.router.close();
  } catch (e) {
    logger.warn({ err: e, roomId }, 'Erro ao fechar router');
  }

  rooms.delete(roomId);

  logger.info({ roomId }, 'ROOM_CLOSED');
  return true;
}

module.exports = {
  rooms,
  createRoom,
  createRoomWithGeneratedId,
  getRoom,
  listRooms,
  closeRoom,
  cancelAutoClose,
  scheduleAutoCloseIfEmpty
};

