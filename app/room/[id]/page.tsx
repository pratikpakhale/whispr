"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  importKey,
  encrypt,
  decrypt,
  encryptBuffer,
  decryptBuffer,
  deriveKeyFromPassphrase,
  decryptRoomKey,
} from "@/lib/crypto";
import { sendSignal, pollSignal } from "@/lib/signal";
import {
  createPeerConnection,
  createDataChannel,
  setupDataChannel,
  createOffer,
  createAnswer,
  acceptAnswer,
  type ConnectionState,
  type PeerCallbacks,
} from "@/lib/webrtc";

interface ChatMessage {
  id: string;
  text: string;
  sender: "me" | "peer";
  timestamp: number;
  type: "text" | "file-meta" | "image";
  fileName?: string;
  fileSize?: number;
  fileUrl?: string;
}

interface FileTransfer {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  chunks: ArrayBuffer[];
  receivedSize: number;
}

const CHUNK_SIZE = 16 * 1024; // 16KB chunks

export default function RoomPage() {
  const params = useParams();
  const roomId = params.id as string;

  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [showWarning, setShowWarning] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [isCreator, setIsCreator] = useState(false);

  // Passphrase state
  const [needsPassphrase, setNeedsPassphrase] = useState(false);
  const [passphraseInput, setPassphraseInput] = useState("");
  const [passphraseError, setPassphraseError] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const encFragmentRef = useRef<{ encryptedKey: string; salt: string } | null>(null);
  const [isPassphraseProtected, setIsPassphraseProtected] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFilesRef = useRef<Map<string, FileTransfer>>(new Map());
  const keyRef = useRef<CryptoKey | null>(null);

  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;

    if (hash.startsWith("enc:")) {
      // Passphrase-protected room
      const parts = hash.split(":");
      if (parts.length >= 3) {
        encFragmentRef.current = {
          encryptedKey: parts[1],
          salt: parts[2],
        };
        setNeedsPassphrase(true);
        setIsPassphraseProtected(true);
      }
    } else {
      importKey(hash).then((key) => {
        setCryptoKey(key);
        keyRef.current = key;
      });
    }
  }, []);

  const handlePeerMessage = useCallback(
    async (data: string) => {
      const key = keyRef.current;
      if (!key) return;
      try {
        const decrypted = await decrypt(key, data);
        const parsed = JSON.parse(decrypted);

        if (parsed.type === "text") {
          addMessage({
            id: crypto.randomUUID(),
            text: parsed.text,
            sender: "peer",
            timestamp: parsed.timestamp,
            type: "text",
          });
        } else if (parsed.type === "file-start") {
          pendingFilesRef.current.set(parsed.id, {
            id: parsed.id,
            name: parsed.name,
            size: parsed.size,
            mimeType: parsed.mimeType,
            chunks: [],
            receivedSize: 0,
          });
        } else if (parsed.type === "file-end") {
          const transfer = pendingFilesRef.current.get(parsed.id);
          if (!transfer) return;
          pendingFilesRef.current.delete(parsed.id);

          const blob = new Blob(transfer.chunks, { type: transfer.mimeType });
          const url = URL.createObjectURL(blob);
          const isImage = transfer.mimeType.startsWith("image/");

          addMessage({
            id: crypto.randomUUID(),
            text: transfer.name,
            sender: "peer",
            timestamp: Date.now(),
            type: isImage ? "image" : "file-meta",
            fileName: transfer.name,
            fileSize: transfer.size,
            fileUrl: url,
          });
        }
      } catch (e) {
        console.error("Failed to decrypt message:", e);
      }
    },
    [addMessage]
  );

  const handleBinaryMessage = useCallback(
    async (data: ArrayBuffer) => {
      const key = keyRef.current;
      if (!key) return;
      try {
        const view = new Uint8Array(data);
        const idLength = view[0];
        const idBytes = view.slice(1, 1 + idLength);
        const fileId = new TextDecoder().decode(idBytes);
        const chunkData = view.slice(1 + idLength).buffer;

        const decrypted = await decryptBuffer(key, chunkData);
        const transfer = pendingFilesRef.current.get(fileId);
        if (!transfer) return;

        transfer.chunks.push(decrypted);
        transfer.receivedSize += decrypted.byteLength;
      } catch (e) {
        console.error("Failed to decrypt chunk:", e);
      }
    },
    []
  );

  const startConnection = useCallback(
    async (key: CryptoKey) => {
      const callbacks: PeerCallbacks = {
        onMessage: handlePeerMessage,
        onBinaryMessage: handleBinaryMessage,
        onStateChange: setConnectionState,
      };

      const existingOffer = await pollSignal(roomId, "offer");

      if (existingOffer) {
        // Joiner flow
        setIsCreator(false);
        setConnectionState("connecting");

        const pc = createPeerConnection(callbacks);
        pcRef.current = pc;

        pc.ondatachannel = (e) => {
          dcRef.current = e.channel;
          setupDataChannel(e.channel, callbacks);
        };

        const offerData = JSON.parse(await decrypt(key, existingOffer));
        const answer = await createAnswer(pc, offerData);
        const encryptedAnswer = await encrypt(key, JSON.stringify(answer));
        await sendSignal(roomId, "answer", encryptedAnswer);
      } else {
        // Creator flow
        setIsCreator(true);
        setConnectionState("waiting");

        const pc = createPeerConnection(callbacks);
        pcRef.current = pc;
        dcRef.current = createDataChannel(pc, callbacks);

        const offer = await createOffer(pc);
        const encryptedOffer = await encrypt(key, JSON.stringify(offer));
        await sendSignal(roomId, "offer", encryptedOffer);

        pollRef.current = setInterval(async () => {
          const answerData = await pollSignal(roomId, "answer");
          if (answerData) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setConnectionState("connecting");
            const decryptedAnswer = JSON.parse(await decrypt(key, answerData));
            await acceptAnswer(pc, decryptedAnswer);
          }
        }, 1000);
      }
    },
    [roomId, handlePeerMessage, handleBinaryMessage]
  );

  useEffect(() => {
    if (!cryptoKey) return;
    startConnection(cryptoKey);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pcRef.current?.close();
    };
  }, [cryptoKey, startConnection]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (messages.length > 0) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [messages]);

  async function sendMessage() {
    if (!input.trim() || !cryptoKey || !dcRef.current) return;
    if (dcRef.current.readyState !== "open") return;

    const msg = {
      type: "text",
      text: input.trim(),
      timestamp: Date.now(),
    };

    const encrypted = await encrypt(cryptoKey, JSON.stringify(msg));
    dcRef.current.send(encrypted);

    addMessage({
      id: crypto.randomUUID(),
      text: input.trim(),
      sender: "me",
      timestamp: msg.timestamp,
      type: "text",
    });

    setInput("");
  }

  async function sendFile(file: File) {
    if (!cryptoKey || !dcRef.current) return;
    if (dcRef.current.readyState !== "open") return;

    const fileId = crypto.randomUUID().slice(0, 8);

    const startMsg = await encrypt(
      cryptoKey,
      JSON.stringify({
        type: "file-start",
        id: fileId,
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
      })
    );
    dcRef.current.send(startMsg);

    const buffer = await file.arrayBuffer();
    const idBytes = new TextEncoder().encode(fileId);

    for (let offset = 0; offset < buffer.byteLength; offset += CHUNK_SIZE) {
      const chunk = buffer.slice(offset, offset + CHUNK_SIZE);
      const encrypted = await encryptBuffer(cryptoKey, chunk);
      const encBytes = new Uint8Array(encrypted);

      const packet = new Uint8Array(1 + idBytes.length + encBytes.length);
      packet[0] = idBytes.length;
      packet.set(idBytes, 1);
      packet.set(encBytes, 1 + idBytes.length);

      dcRef.current.send(packet.buffer);
      await new Promise((r) => setTimeout(r, 5));
    }

    const endMsg = await encrypt(
      cryptoKey,
      JSON.stringify({ type: "file-end", id: fileId })
    );
    dcRef.current.send(endMsg);

    const isImage = file.type.startsWith("image/");
    const url = URL.createObjectURL(file);

    addMessage({
      id: crypto.randomUUID(),
      text: file.name,
      sender: "me",
      timestamp: Date.now(),
      type: isImage ? "image" : "file-meta",
      fileName: file.name,
      fileSize: file.size,
      fileUrl: url,
    });
  }

  async function handlePassphraseSubmit() {
    if (!passphraseInput || !encFragmentRef.current) return;
    setUnlocking(true);
    setPassphraseError("");
    try {
      const { encryptedKey, salt } = encFragmentRef.current;
      // Decode salt from base64url
      let saltB64 = salt.replace(/-/g, "+").replace(/_/g, "/");
      while (saltB64.length % 4) saltB64 += "=";
      const saltBytes = new Uint8Array(
        atob(saltB64).split("").map((c) => c.charCodeAt(0))
      );
      const passphraseKey = await deriveKeyFromPassphrase(passphraseInput, saltBytes);
      const roomKey = await decryptRoomKey(encryptedKey, passphraseKey);
      setCryptoKey(roomKey);
      keyRef.current = roomKey;
      setNeedsPassphrase(false);
    } catch {
      setPassphraseError("Incorrect passphrase");
    } finally {
      setUnlocking(false);
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(window.location.href);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  function formatTime(ts: number) {
    return new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (needsPassphrase) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-sm w-full space-y-6 animate-fade-in">
          <div className="text-center space-y-2">
            <div className="flex justify-center mb-4">
              <div className="w-12 h-12 rounded-full bg-whispr-accent/10 flex items-center justify-center">
                <ShieldLockIcon />
              </div>
            </div>
            <h2 className="text-xl font-medium">Passphrase Required</h2>
            <p className="text-whispr-muted text-sm">
              This room is passphrase-protected. Enter the passphrase to join.
            </p>
          </div>

          <div className="space-y-3">
            <input
              type="password"
              value={passphraseInput}
              onChange={(e) => {
                setPassphraseInput(e.target.value);
                setPassphraseError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && handlePassphraseSubmit()}
              placeholder="Enter passphrase"
              autoFocus
              className="w-full bg-whispr-surface border border-whispr-border rounded-lg px-4 py-3 text-sm
                         placeholder:text-whispr-muted/50 focus:outline-none focus:border-whispr-accent/50
                         transition-colors"
            />
            {passphraseError && (
              <p className="text-whispr-red text-sm text-center">{passphraseError}</p>
            )}
            <button
              onClick={handlePassphraseSubmit}
              disabled={unlocking || !passphraseInput}
              className="w-full py-3 px-6 bg-whispr-accent hover:bg-whispr-accent/90 disabled:opacity-50
                         rounded-lg text-white font-medium transition-all duration-200
                         focus:outline-none focus:ring-2 focus:ring-whispr-accent/50"
            >
              {unlocking ? "Decrypting..." : "Enter Room"}
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!cryptoKey) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center space-y-3">
          <h2 className="text-xl font-medium">Invalid room link</h2>
          <p className="text-whispr-muted text-sm">
            The encryption key is missing from the URL. Ask for a new link.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="h-screen flex flex-col">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-whispr-border bg-whispr-surface/50 backdrop-blur px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">whispr</h1>
            <StatusBadge state={connectionState} />
          </div>
          <div className="flex items-center gap-2">
            {isPassphraseProtected && (
              <span className="text-[10px] px-2 py-1 rounded-full bg-whispr-accent/10 text-whispr-accent flex items-center gap-1">
                🔐 Passphrase
              </span>
            )}
            {isCreator && connectionState === "waiting" && (
              <button
                onClick={copyLink}
                className="text-xs px-3 py-1.5 rounded-md bg-whispr-accent/20 text-whispr-accent
                           hover:bg-whispr-accent/30 transition-colors"
              >
                {linkCopied ? "Copied!" : "Copy Link"}
              </button>
            )}
            <button
              onClick={() => setShowWarning(true)}
              className="text-xs px-3 py-1.5 rounded-md bg-whispr-red/10 text-whispr-red
                         hover:bg-whispr-red/20 transition-colors"
            >
              Leave
            </button>
          </div>
        </div>
      </header>

      {/* Privacy badge */}
      <div className="flex-shrink-0 flex justify-center py-2">
        <div className="flex items-center gap-1.5 text-[10px] text-whispr-muted">
          <LockIcon />
          <span>End-to-end encrypted &bull; P2P &bull; Zero server storage</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="max-w-2xl mx-auto space-y-3 pt-2">
          {connectionState === "waiting" && (
            <div className="text-center py-12 space-y-4 animate-fade-in">
              <div className="text-whispr-muted animate-pulse-glow">
                Waiting for peer to join...
              </div>
              <div className="text-xs text-whispr-muted/60">
                Share the link to invite someone. The encryption key is embedded in the URL.
              </div>
            </div>
          )}

          {connectionState === "connecting" && (
            <div className="text-center py-12 animate-fade-in">
              <div className="text-whispr-amber">Establishing secure connection...</div>
            </div>
          )}

          {connectionState === "connected" && messages.length === 0 && (
            <div className="text-center py-12 animate-fade-in">
              <div className="text-whispr-green mb-2">Connected securely</div>
              <div className="text-xs text-whispr-muted">
                Messages are encrypted end-to-end and will vanish when you close this tab.
              </div>
            </div>
          )}

          {connectionState === "disconnected" && (
            <div className="text-center py-4 animate-fade-in">
              <div className="text-whispr-red text-sm">Peer disconnected</div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.sender === "me" ? "justify-end" : "justify-start"} animate-fade-in`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                  msg.sender === "me"
                    ? "bg-whispr-accent text-white rounded-br-sm"
                    : "bg-whispr-surface border border-whispr-border rounded-bl-sm"
                }`}
              >
                {msg.type === "text" && (
                  <p className="text-sm whitespace-pre-wrap break-words">{msg.text}</p>
                )}

                {msg.type === "image" && msg.fileUrl && (
                  <div className="space-y-2">
                    <img
                      src={msg.fileUrl}
                      alt={msg.fileName}
                      className="max-w-full rounded-lg max-h-64 object-contain"
                    />
                    <p className="text-xs opacity-70">{msg.fileName}</p>
                  </div>
                )}

                {msg.type === "file-meta" && (
                  <a
                    href={msg.fileUrl}
                    download={msg.fileName}
                    className="flex items-center gap-2 text-sm hover:underline"
                  >
                    <FileIcon />
                    <div>
                      <div className="break-all">{msg.fileName}</div>
                      <div className="text-xs opacity-60">
                        {formatSize(msg.fileSize ?? 0)}
                      </div>
                    </div>
                  </a>
                )}

                <div
                  className={`text-[10px] mt-1 ${
                    msg.sender === "me" ? "text-white/50" : "text-whispr-muted"
                  }`}
                >
                  {formatTime(msg.timestamp)}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-whispr-border bg-whispr-surface/50 backdrop-blur px-4 py-3">
        <div className="max-w-2xl mx-auto flex gap-2">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) sendFile(file);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={connectionState !== "connected"}
            className="flex-shrink-0 p-2.5 rounded-lg bg-whispr-border hover:bg-whispr-border/80
                       disabled:opacity-30 transition-colors"
            title="Send file"
          >
            <PaperclipIcon />
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
            placeholder={
              connectionState === "connected"
                ? "Type a message..."
                : "Waiting for connection..."
            }
            disabled={connectionState !== "connected"}
            className="flex-1 bg-whispr-bg border border-whispr-border rounded-lg px-4 py-2.5 text-sm
                       placeholder:text-whispr-muted/50 focus:outline-none focus:border-whispr-accent/50
                       disabled:opacity-30 transition-colors"
          />
          <button
            onClick={sendMessage}
            disabled={connectionState !== "connected" || !input.trim()}
            className="flex-shrink-0 p-2.5 rounded-lg bg-whispr-accent hover:bg-whispr-accent/90
                       disabled:opacity-30 transition-colors"
          >
            <SendIcon />
          </button>
        </div>
      </div>

      {/* Leave warning modal */}
      {showWarning && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-whispr-surface border border-whispr-border rounded-xl p-6 max-w-sm w-full space-y-4 animate-fade-in">
            <h3 className="text-lg font-medium">Leave room?</h3>
            <p className="text-sm text-whispr-muted">
              Messages cannot be recovered after closing this tab. All chat history will be permanently destroyed.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowWarning(false)}
                className="flex-1 py-2 rounded-lg border border-whispr-border text-sm hover:bg-whispr-border/50 transition-colors"
              >
                Stay
              </button>
              <button
                onClick={() => window.close()}
                className="flex-1 py-2 rounded-lg bg-whispr-red text-white text-sm hover:bg-whispr-red/90 transition-colors"
              >
                Leave & Destroy
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function StatusBadge({ state }: { state: ConnectionState }) {
  const config = {
    idle: { color: "text-whispr-muted", bg: "bg-whispr-muted/10", label: "Initializing" },
    waiting: { color: "text-whispr-amber", bg: "bg-whispr-amber/10", label: "Waiting for peer..." },
    connecting: { color: "text-whispr-amber", bg: "bg-whispr-amber/10", label: "Connecting..." },
    connected: { color: "text-whispr-green", bg: "bg-whispr-green/10", label: "Connected \uD83D\uDD12" },
    disconnected: { color: "text-whispr-red", bg: "bg-whispr-red/10", label: "Peer disconnected" },
  }[state];

  return (
    <span className={`text-xs px-2 py-1 rounded-full ${config.color} ${config.bg}`}>
      {config.label}
    </span>
  );
}

function LockIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

function ShieldLockIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         className="text-whispr-accent">
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <rect width="8" height="5" x="8" y="11" rx="1" />
      <path d="M10 11V9a2 2 0 1 1 4 0v2" />
    </svg>
  );
}
