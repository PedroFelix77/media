const { logger } = require('../logger');

/**
 * Peer mantém recursos MediaSoup:
 * - sendTransport, recvTransport
 * - producers, consumers
 */
class Peer {
  constructor({ id, userId, callId, role, room, onClose }) {
    this.id = id;
    this.userId = userId;
    this.callId = callId;
    this.role = role;
    this.room = room;
    this.onClose = typeof onClose === 'function' ? onClose : null;

    this.sendTransport = null;
    this.recvTransport = null;
    this.producers = new Map();
    this.consumers = new Map();

    this.closed = false;
  }

  close(reason = 'closed') {
    if (this.closed) return;
    this.closed = true;

    // Cleanup agressivo na ordem recomendada:
    // consumer.close() -> producer.close() -> transport.close() -> remove peer
    for (const consumer of this.consumers.values()) {
      try {
        consumer.close();
      } catch (e) {
        logger.warn({ err: e, peerId: this.id }, 'Erro ao fechar consumer');
      }
    }
    this.consumers.clear();

    for (const producer of this.producers.values()) {
      try {
        producer.close();
      } catch (e) {
        logger.warn({ err: e, peerId: this.id }, 'Erro ao fechar producer');
      }
    }
    this.producers.clear();

    if (this.sendTransport) {
      try {
        this.sendTransport.close();
      } catch (e) {
        logger.warn({ err: e, peerId: this.id }, 'Erro ao fechar sendTransport');
      }
      this.sendTransport = null;
    }
    if (this.recvTransport) {
      try {
        this.recvTransport.close();
      } catch (e) {
        logger.warn({ err: e, peerId: this.id }, 'Erro ao fechar recvTransport');
      }
      this.recvTransport = null;
    }

    try {
      this.room.peers.delete(this.id);
    } catch {
      // ignore
    }

    try {
      this.onClose?.(this, reason);
    } catch {
      // ignore
    }

    logger.info(
      { peerId: this.id, userId: this.userId, callId: this.callId, roomId: this.room.id, reason },
      'PEER_CLOSED'
    );
  }
}

module.exports = { Peer };

