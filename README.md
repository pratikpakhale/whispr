# Whispr

Privacy-first, peer-to-peer encrypted ephemeral chat. No message content ever touches the server.

## How it works

- **Room creation** generates a random room ID and AES-256 encryption key
- The key lives **only** in the URL fragment (`#key`) — never sent to the server
- WebRTC DataChannels provide direct P2P communication
- All messages are AES-GCM encrypted client-side before sending
- The server only stores ephemeral signaling data (SDP offers/answers) with a 2-minute TTL
- Messages exist only in browser memory and vanish on tab close

## Stack

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS
- Vercel KV (ephemeral signaling only)
- WebRTC DataChannels
- Web Crypto API (AES-256-GCM)

## Setup

### Local Development

```bash
npm install
npm run dev
```

No Vercel KV needed for local dev — the app falls back to in-memory signaling automatically.

### Production (Vercel)

1. Create a [Vercel KV](https://vercel.com/docs/storage/vercel-kv) store
2. Link it to your project (this auto-sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`)
3. Deploy:

```bash
vercel deploy
```

### Environment Variables

```
KV_REST_API_URL=     # Vercel KV REST API URL
KV_REST_API_TOKEN=   # Vercel KV REST API token
```

Copy `.env.example` to `.env.local` and fill in the values, or let Vercel auto-configure them.

## Features

- **End-to-end encryption**: AES-256-GCM on top of WebRTC DTLS
- **P2P messaging**: Direct peer connection, no message relay
- **File & image sharing**: Chunked encrypted transfer with inline image previews
- **Ephemeral**: Zero persistent storage, messages vanish on tab close
- **No accounts**: No signup, no login, no tracking
- **Mobile-first**: Responsive dark UI

## Privacy Model

| Data | Server sees? | Stored? |
|------|-------------|---------|
| Messages | No | Never (RAM only) |
| Files | No | Never (RAM only) |
| Encryption key | No (URL fragment) | Never |
| Room ID | Yes (opaque string) | 2 min TTL |
| SDP signaling | Encrypted blob only | 2 min TTL |
