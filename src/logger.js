const pino = require('pino');

const logger = pino({
  level: process.env.SFU_LOG_LEVEL || 'info',
  base: undefined
});

module.exports = { logger };

