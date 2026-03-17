const os = require('node:os');
const mediasoup = require('mediasoup');
const { config } = require('../config');
const { logger } = require('../logger');

/** @type {import('mediasoup/node/lib/Worker').Worker[]} */
let workers = [];
let nextWorkerIndex = 0;

function getWorkers() {
  return workers;
}

function pickWorkerLeastRouters() {
  if (workers.length === 0) {
    throw new Error('Workers não inicializados.');
  }

  // Estratégia simples: menor número de routers ativos por worker (evita round-robin cego).
  // Nota: worker.routers é interno; preferimos manter nosso contador.
  let best = workers[0];
  for (const w of workers) {
    if ((w.__routerCount || 0) < (best.__routerCount || 0)) best = w;
  }
  return best;
}

async function startWorkers() {
  const numWorkers = Math.max(1, config.mediasoup.numWorkers || os.cpus().length);
  logger.info({ numWorkers }, 'Inicializando workers mediasoup');

  workers = [];
  nextWorkerIndex = 0;

  for (let i = 0; i < numWorkers; i++) {
    const worker = await mediasoup.createWorker({
      rtcMinPort: config.mediasoup.rtcMinPort,
      rtcMaxPort: config.mediasoup.rtcMaxPort
    });
    worker.__routerCount = 0;

    worker.on('died', () => {
      logger.error({ pid: worker.pid }, 'Worker mediasoup morreu - reinício necessário');
      // Em produção: implementar estratégia de reinício.
      process.exit(1);
    });

    logger.info({ pid: worker.pid }, 'Worker mediasoup pronto');
    workers.push(worker);
  }
}

async function closeWorkers() {
  for (const w of workers) {
    try {
      w.close();
    } catch (e) {
      logger.warn({ err: e }, 'Erro ao fechar worker');
    }
  }
  workers = [];
}

async function createRouterForRoom() {
  // Router deve ser criado por room (recomendação MediaSoup), não global por worker.
  const worker = pickWorkerLeastRouters();
  const router = await worker.createRouter({ mediaCodecs: config.mediasoup.mediaCodecs });
  worker.__routerCount = (worker.__routerCount || 0) + 1;

  router.observer.on('close', () => {
    worker.__routerCount = Math.max(0, (worker.__routerCount || 0) - 1);
  });

  return { router, workerPid: worker.pid };
}

module.exports = {
  startWorkers,
  closeWorkers,
  getWorkers,
  createRouterForRoom
};

