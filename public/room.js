/**
 * Sala de chamada — cliente mediasoup (WebSocket + WebRTC)
 */
import { Device } from 'mediasoup-client';

(function () {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const wsUrl = params.get('wsUrl');
  const roomId = params.get('roomId');

  const statusEl = document.getElementById('status');
  const videosEl = document.getElementById('videos');
  const roomIdEl = document.getElementById('roomId');
  const btnLeave = document.getElementById('btnLeave');

  function setStatus(msg, isError = false) {
    statusEl.textContent = msg;
    statusEl.className = 'status ' + (isError ? 'error' : 'connecting');
  }

  function showVideos() {
    statusEl.style.display = 'none';
    videosEl.style.display = 'grid';
  }

  if (!token || !wsUrl) {
    setStatus('Token ou URL do WebSocket ausente. Volte e entre na sala.', true);
    roomIdEl.textContent = roomId || '—';
    return;
  }

  if (roomId) roomIdEl.textContent = roomId;

  let ws = null;
  let device = null;
  let sendTransport = null;
  let recvTransport = null;
  let localStream = null;
  const pending = new Map();
  let nextId = 1;

  function send(msg) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ ...msg, id }));
    });
  }

  function connectWs() {
    return new Promise((resolve, reject) => {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Falha ao conectar WebSocket'));
      ws.onclose = () => {
        setStatus('Conexão fechada.', true);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.action === 'ping') {
            ws.send(JSON.stringify({ action: 'pong', ts: msg.ts }));
            return;
          }
          if (msg.action === 'pong') return;
          if (msg.action === 'newProducer') {
            onNewProducer(msg.data);
            return;
          }
          const p = pending.get(msg.id);
          if (p) {
            pending.delete(msg.id);
            if (msg.ok) p.resolve(msg.data);
            else p.reject(new Error((msg.error && msg.error.message) || 'Erro'));
          }
        } catch (e) {
          console.warn('WS message parse error', e);
        }
      };
    });
  }

  async function onNewProducer(data) {
    if (!device || !recvTransport) return;
    const { producerId, peerId, kind } = data;
    try {
      const caps = device.rtpCapabilities;
      const res = await send({
        action: 'consume',
        producerId,
        rtpCapabilities: caps
      });
      if (res.producerClosed) return;
      await send({ action: 'resumeConsumer', consumerId: res.id });
      const consumer = await recvTransport.consume({
        id: res.id,
        producerId: res.producerId,
        kind: res.kind,
        rtpParameters: res.rtpParameters,
        type: res.type
      });
      addRemoteTrack(consumer.track, peerId, kind);
    } catch (e) {
      console.warn('Consume error', e);
    }
  }

  function addLocalVideo(stream) {
    const wrap = document.createElement('div');
    wrap.className = 'video-wrap local';
    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    wrap.appendChild(video);
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = 'Você';
    wrap.appendChild(label);
    videosEl.appendChild(wrap);
  }

  function addRemoteTrack(track, peerId, kind) {
    const wrap = document.createElement('div');
    wrap.className = 'video-wrap remote';
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    const stream = new MediaStream([track]);
    video.srcObject = stream;
    wrap.appendChild(video);
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = peerId || (kind === 'video' ? 'Remoto (vídeo)' : 'Remoto (áudio)');
    wrap.appendChild(label);
    videosEl.appendChild(wrap);
  }

  async function run() {
    try {
      setStatus('Conectando ao servidor…');
      await connectWs();

      setStatus('Entrando na sala…');
      const joinData = await send({ action: 'join', token });
      const { rtpCapabilities } = joinData;

      setStatus('Iniciando mídia…');
      device = new Device();
      await device.load({ routerRtpCapabilities: rtpCapabilities });

      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      showVideos();
      addLocalVideo(localStream);

      // Send transport
      const sendTransportData = await send({ action: 'createWebRtcTransport', direction: 'send' });
      sendTransport = device.createSendTransport({
        id: sendTransportData.id,
        iceParameters: sendTransportData.iceParameters,
        iceCandidates: sendTransportData.iceCandidates,
        dtlsParameters: sendTransportData.dtlsParameters
      });

      sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          await send({ action: 'connectWebRtcTransport', transportId: sendTransport.id, dtlsParameters });
          callback();
        } catch (e) {
          errback(e);
        }
      });

      sendTransport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
        try {
          const res = await send({ action: 'produce', kind, rtpParameters, appData });
          callback({ id: res.id });
        } catch (e) {
          errback(e);
        }
      });

      const videoTrack = localStream.getVideoTracks()[0];
      const audioTrack = localStream.getAudioTracks()[0];
      if (videoTrack) await sendTransport.produce({ track: videoTrack, appData: { source: 'webcam' } });
      if (audioTrack) await sendTransport.produce({ track: audioTrack, appData: { source: 'mic' } });

      // Recv transport
      const recvTransportData = await send({ action: 'createWebRtcTransport', direction: 'recv' });
      recvTransport = device.createRecvTransport({
        id: recvTransportData.id,
        iceParameters: recvTransportData.iceParameters,
        iceCandidates: recvTransportData.iceCandidates,
        dtlsParameters: recvTransportData.dtlsParameters
      });

      recvTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          await send({ action: 'connectWebRtcTransport', transportId: recvTransport.id, dtlsParameters });
          callback();
        } catch (e) {
          errback(e);
        }
      });

      setStatus('');
    } catch (e) {
      console.error(e);
      setStatus(e.message || 'Erro ao entrar na sala.', true);
    }
  }

  btnLeave.addEventListener('click', async () => {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) await send({ action: 'leave' });
      if (localStream) localStream.getTracks().forEach((t) => t.stop());
      if (sendTransport && !sendTransport.closed) sendTransport.close();
      if (recvTransport && !recvTransport.closed) recvTransport.close();
      if (ws) ws.close();
    } finally {
      window.location.href = '/';
    }
  });

  run();
})();
