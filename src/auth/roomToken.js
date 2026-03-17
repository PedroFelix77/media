const jwt = require('jsonwebtoken');
const { config } = require('../config');

function validateRoomToken(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Token ausente.');
  }
  const payload = jwt.verify(token, config.auth.jwtSecret, {
    algorithms: ['HS256']
  });

  const callId = payload.callId || payload.call_id;
  const roomId = payload.roomId || payload.room_id;
  const userId = payload.userId || payload.user_id;
  const role = payload.role || 'user';

  if (!callId || !roomId || !userId) {
    throw new Error('Token inválido (callId/roomId/userId ausentes).');
  }

  return {
    callId: String(callId),
    roomId: String(roomId),
    userId: String(userId),
    role: String(role)
  };
}

module.exports = { validateRoomToken };

