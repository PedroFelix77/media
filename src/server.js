require("dotenv").config();

const { config } = require("./config");
const { logger } = require("./logger");
const { startWorkers, closeWorkers } = require("./mediasoup/workers");
const { startHttpServer } = require("./http/httpServer");
const { startWsServer } = require("./ws/wsServer");

async function main() {
  if (!config.auth.jwtSecret) {
    throw new Error("SFU_JWT_SECRET não configurado.");
  }
  if (!config.http.apiSecret) {
    throw new Error("SFU_API_SECRET não configurado.");
  }

  logger.info(
    {
      nodeId: config.nodeId,
      httpPort: config.http.port,
      wsPort: config.ws.port,
      numWorkers: config.mediasoup.numWorkers,
    },
    "SFU iniciando",
  );

  await startWorkers();

  const httpServer = await startHttpServer();
  const wsServer = await startWsServer();

  const shutdown = async (signal) => {
    logger.info({ signal }, "SFU encerrando");
    try {
      wsServer.close();
    } catch (e) {
      logger.warn({ err: e }, "Falha ao fechar WS");
    }
    try {
      httpServer.close();
    } catch (e) {
      logger.warn({ err: e }, "Falha ao fechar HTTP");
    }
    await closeWorkers();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "Falha fatal ao iniciar SFU");
  process.exit(1);
});
