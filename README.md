# MediaSoup SFU (Servidor de Mídia)

Servidor SFU baseado em **MediaSoup** para o módulo de videochamada do projeto.

## O que este serviço entrega

- **WebSocket** para sinalização de mídia (frontend ⇄ SFU), autenticado por **JWT** (emitido pelo Laravel).
- **API HTTP** para o backend criar/encerrar salas:
  - `POST /rooms`
  - `DELETE /rooms/:roomId`
- Arquitetura alinhada ao projeto:
  - **1 router por room**
  - **2 transports por peer**: `sendTransport` e `recvTransport`

## Variáveis de ambiente

- **Obrigatórias**
  - `SFU_JWT_SECRET`: segredo HS256 para validar token de sala (mesmo segredo usado no Laravel).
  - `SFU_API_SECRET`: segredo para autenticar a API HTTP (Laravel/Gateway → SFU).

- **Portas**
  - `SFU_HTTP_PORT` (default `3000`)
  - `SFU_WS_PORT` (default `4443`)

- **Workers**
  - `SFU_NUM_WORKERS` (default: número de CPUs)

- **RTP/ICE**
  - `SFU_RTC_MIN_PORT` (default `40000`)
  - `SFU_RTC_MAX_PORT` (default `49999`)
  - `SFU_LISTEN_IP` (default `0.0.0.0`)
  - `SFU_ANNOUNCED_IP` (opcional; IP público anunciado em cenários com NAT/LB)

- **Bitrate (telemedicina)**
  - `SFU_MAX_INCOMING_BITRATE` (default `1500000`) (bps)

## Rodar localmente

1. Instale dependências dentro de `mediasoup-server`:

```bash
cd mediasoup-server
npm i
```

2. Suba o servidor:

```bash
export SFU_JWT_SECRET='dev-secret'
export SFU_API_SECRET='dev-api-secret'
export SFU_HTTP_PORT=3100
export SFU_WS_PORT=4444
npm run dev
```

3. Smoke test da API HTTP (em outro terminal):

```bash
# requer jq
chmod +x scripts/smoke.sh
./scripts/smoke.sh
```

## Integração com o Laravel (visão rápida)

- Laravel emite token JWT com payload (`callId`, `roomId`, `userId`, `role`, `iat`, `exp`) e o envia ao frontend via evento `VideoCallAccepted`.
- Frontend conecta em `SFU_WS_URL` e envia **apenas** o token ao SFU.
- Laravel (ou Media Gateway) chama:
  - `POST /rooms` para criar a room no SFU e obter `room_id`.
  - `DELETE /rooms/:roomId` para encerrar a room.

