const { config } = require('../config');

async function createWebRtcTransport(router) {
  const listenIps = [
    {
      ip: config.mediasoup.listenIp,
      announcedIp: config.mediasoup.announcedIp || undefined
    }
  ];

  const transport = await router.createWebRtcTransport({
    listenIps,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 1_000_000
  });

  // Limite de bitrate de entrada (telemedicina).
  if (config.mediasoup.maxIncomingBitrate && config.mediasoup.maxIncomingBitrate > 0) {
    try {
      await transport.setMaxIncomingBitrate(config.mediasoup.maxIncomingBitrate);
    } catch {
      // algumas versões/condições podem falhar; manter transport funcional
    }
  }

  return transport;
}

module.exports = { createWebRtcTransport };

