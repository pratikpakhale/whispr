# whispr

Private, end-to-end encrypted, peer-to-peer messaging and video calls. No servers relay your data. No logs. No accounts. Messages vanish when you close the tab.

## How It Works

1. **Room creation** generates a random room ID and an AES-256-GCM encryption key
2. The key is placed in the URL fragment (`#key`) — fragments are never sent to the server
3. Signaling (SDP offer/answer exchange) happens through Upstash Redis with a 5-minute TTL
4. Once both peers exchange signals, a direct WebRTC connection is established
5. All messages and files are encrypted client-side before being sent over the DataChannel
6. Video/audio calls use WebRTC media tracks with DTLS-SRTP encryption
7. Optionally, rooms can be passphrase-protected — the key is encrypted with PBKDF2 (200k iterations) and only decryptable with the correct passphrase

## Features

- **Text messaging** — real-time encrypted chat over WebRTC DataChannels
- **File & image sharing** — chunked encrypted transfer with inline image previews
- **Video & audio calls** — peer-to-peer with Cloudflare TURN relay fallback
- **Passphrase protection** — optional second layer requiring a shared secret to join
- **Photo capture** — snap and send photos directly from the video call
- **Ephemeral** — zero persistent storage, everything lives in browser memory only

## Tech Stack

- [Next.js 14](https://nextjs.org/) (App Router, TypeScript)
- [WebRTC](https://webrtc.org/) — P2P data channels and media streams
- [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) — AES-256-GCM encryption, PBKDF2 key derivation
- [shadcn/ui](https://ui.shadcn.com/) + [Tailwind CSS](https://tailwindcss.com/) — component library and styling
- [lucide-react](https://lucide.dev/) — icons
- [Upstash Redis](https://upstash.com/) — ephemeral signaling storage (5-min TTL)
- [Cloudflare TURN](https://developers.cloudflare.com/calls/turn/) — relay server for restrictive NATs

## Security Model

| Data | Server sees? | Stored? |
|------|-------------|---------|
| Messages & files | No (encrypted P2P) | Never (browser RAM only) |
| Encryption key | No (URL fragment) | Never |
| Video/audio streams | No (DTLS-SRTP P2P) | Never |
| Room ID | Yes (opaque string) | 5-min TTL |
| SDP signaling | Encrypted blob only | 5-min TTL |
| Passphrase | No (client-side only) | Never |

The encryption key never leaves the client. URL fragments (`#...`) are not included in HTTP requests, server logs, or referrer headers. Video and audio are encrypted at the WebRTC transport layer via DTLS-SRTP.

## Local Development

```bash
npm install
npm run dev
```

No external services needed for local dev — the app uses an in-memory signaling fallback automatically. Video calls will work peer-to-peer on localhost without TURN.

## Production Deployment

Deploy to [Vercel](https://vercel.com/) and configure the following environment variables:

```
KV_REST_API_URL        # Upstash Redis REST API URL
KV_REST_API_TOKEN      # Upstash Redis REST API token
CLOUDFLARE_TURN_TOKEN_ID   # Cloudflare TURN token ID
CLOUDFLARE_TURN_API_TOKEN  # Cloudflare TURN API token
```

Copy `.env.example` to `.env.local` for reference. The Upstash Redis credentials are required for signaling in production. The Cloudflare TURN credentials enable relay fallback for peers behind restrictive NATs — without them, the app falls back to public STUN servers (which may not work in all network conditions).

```bash
vercel deploy
```
