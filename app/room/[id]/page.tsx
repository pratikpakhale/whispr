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
import { sendSignal, pollSignal, clearSignals } from "@/lib/signal";
import {
  createPeerConnection,
  createDataChannel,
  setupDataChannel,
  createOffer,
  createAnswer,
  acceptAnswer,
  getIceServers,
  addMediaStream,
  removeMediaTracks,
  setupRenegotiation,
  type ConnectionState,
  type PeerCallbacks,
} from "@/lib/webrtc";
import { cn } from "@/lib/utils";
import {
  ShieldCheck,
  Lock,
  Send,
  Paperclip,
  File as FileIcon,
  Video,
  VideoOff,
  Mic,
  MicOff,
  Camera,
  PhoneOff,
  Copy,
  Check,
  RotateCcw,
  LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

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

  // Video call state
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [inCall, setInCall] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFilesRef = useRef<Map<string, FileTransfer>>(new Map());
  const keyRef = useRef<CryptoKey | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

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
        } else if (parsed.type === "video-offer") {
          const pc = pcRef.current;
          if (!pc) return;
          try {
            // 1. Acquire local media
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            // 2. Set local stream and inCall state
            setLocalStream(stream);
            setInCall(true);
            // 3. Add local tracks to PC BEFORE setRemoteDescription
            addMediaStream(pc, stream);
            // 4. Set remote description, create and send answer
            await pc.setRemoteDescription(new RTCSessionDescription(parsed.sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            // Wait for ICE gathering
            await new Promise<void>((resolve) => {
              if (pc.iceGatheringState === "complete") { resolve(); return; }
              const t = setTimeout(resolve, 3000);
              pc.onicegatheringstatechange = () => {
                if (pc.iceGatheringState === "complete") { clearTimeout(t); resolve(); }
              };
            });
            const answerMsg = await encrypt(key, JSON.stringify({
              type: "video-answer",
              sdp: pc.localDescription!,
            }));
            dcRef.current?.send(answerMsg);
          } catch (e) {
            console.error("Failed to handle video offer:", e);
          }
        } else if (parsed.type === "video-answer") {
          const pc = pcRef.current;
          if (!pc) return;
          await acceptAnswer(pc, parsed.sdp);
        } else if (parsed.type === "video-stop") {
          // Clear remote video
          setRemoteStream(null);
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = null;
          }
          // Stop local tracks via PC senders and clean up
          if (pcRef.current) removeMediaTracks(pcRef.current);
          setLocalStream(null);
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = null;
          }
          setInCall(false);
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
      const searchParams = new URLSearchParams(window.location.search);
      const isCreatorRole = searchParams.get("role") === "creator";
      setIsCreator(isCreatorRole);

      const callbacks: PeerCallbacks = {
        onMessage: handlePeerMessage,
        onBinaryMessage: handleBinaryMessage,
        onStateChange: setConnectionState,
      };

      const iceServers = await getIceServers();

      if (isCreatorRole) {
        // Creator: clear stale signals before posting new offer
        await clearSignals(roomId);
        setConnectionState("waiting");
        const pc = createPeerConnection(callbacks, iceServers);
        pcRef.current = pc;

        pc.ontrack = (e) => {
          if (e.streams && e.streams[0]) {
            setRemoteStream(e.streams[0]);
          } else {
            const stream = new MediaStream([e.track]);
            setRemoteStream(stream);
          }
        };

        dcRef.current = createDataChannel(pc, callbacks);

        const offer = await createOffer(pc);
        const encryptedOffer = await encrypt(key, JSON.stringify(offer));
        await sendSignal(roomId, "offer", encryptedOffer);

        let attempts = 0;
        let processing = false;
        pollRef.current = setInterval(async () => {
          if (processing) return;
          attempts++;
          if (attempts > 60) {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            setConnectionState("disconnected");
            return;
          }
          try {
            const answerData = await pollSignal(roomId, "answer");
            if (answerData) {
              processing = true;
              clearInterval(pollRef.current!);
              pollRef.current = null;
              setConnectionState("connecting");
              const decryptedAnswer = JSON.parse(await decrypt(key, answerData));
              await acceptAnswer(pc, decryptedAnswer);
            }
          } catch (e) {
            console.error("Failed to process answer:", e);
            clearInterval(pollRef.current!);
            pollRef.current = null;
            setConnectionState("disconnected");
          }
        }, 1500);
      } else {
        // Joiner: poll for offer, then answer
        setConnectionState("waiting");
        const pc = createPeerConnection(callbacks, iceServers);
        pcRef.current = pc;

        pc.ontrack = (e) => {
          if (e.streams && e.streams[0]) {
            setRemoteStream(e.streams[0]);
          } else {
            const stream = new MediaStream([e.track]);
            setRemoteStream(stream);
          }
        };

        pc.ondatachannel = (e) => {
          dcRef.current = e.channel;
          setupDataChannel(e.channel, callbacks);
        };

        let attempts = 0;
        let processing = false;
        pollRef.current = setInterval(async () => {
          if (processing) return;
          attempts++;
          if (attempts > 60) {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            setConnectionState("disconnected");
            return;
          }
          try {
            const offerData = await pollSignal(roomId, "offer");
            if (offerData) {
              processing = true;
              clearInterval(pollRef.current!);
              pollRef.current = null;
              setConnectionState("connecting");
              const decryptedOffer = JSON.parse(await decrypt(key, offerData));
              const answer = await createAnswer(pc, decryptedOffer);
              const encryptedAnswer = await encrypt(key, JSON.stringify(answer));
              await sendSignal(roomId, "answer", encryptedAnswer);
            }
          } catch (e) {
            console.error("Failed to process offer:", e);
            clearInterval(pollRef.current!);
            pollRef.current = null;
            setConnectionState("disconnected");
          }
        }, 1500);
      }
    },
    [roomId, handlePeerMessage, handleBinaryMessage]
  );

  const reconnect = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pcRef.current?.close();
    pcRef.current = null;
    dcRef.current = null;
    setConnectionState("idle");
    setMessages([]);
    if (keyRef.current) startConnection(keyRef.current);
  }, [startConnection]);

  useEffect(() => {
    if (!cryptoKey) return;
    startConnection(cryptoKey);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pcRef.current?.close();
    };
  }, [cryptoKey, startConnection]);

  useEffect(() => {
    document.title = "Room \u00b7 whispr";
  }, []);

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

  // Assign video streams to refs
  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // Cleanup local stream on unmount
  useEffect(() => {
    return () => {
      localStream?.getTracks().forEach((t) => t.stop());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startVideoCall() {
    const pc = pcRef.current;
    const dc = dcRef.current;
    const key = keyRef.current;
    if (!pc || !dc || dc.readyState !== "open" || !key) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      addMediaStream(pc, stream);
      setInCall(true);

      setupRenegotiation(pc, async (offer) => {
        const msg = await encrypt(key, JSON.stringify({ type: "video-offer", sdp: offer }));
        dc.send(msg);
      });
    } catch (e) {
      console.error("Failed to start video call:", e);
    }
  }

  async function stopVideoCall() {
    const pc = pcRef.current;
    const dc = dcRef.current;
    const key = keyRef.current;

    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      setLocalStream(null);
    }

    if (pc) removeMediaTracks(pc);

    if (dc && dc.readyState === "open" && key) {
      const msg = await encrypt(key, JSON.stringify({ type: "video-stop" }));
      dc.send(msg);
    }

    setRemoteStream(null);
    setInCall(false);
    setVideoEnabled(true);
    setAudioEnabled(true);
  }

  function toggleVideo() {
    if (!localStream) return;
    const enabled = !videoEnabled;
    localStream.getVideoTracks().forEach((t) => (t.enabled = enabled));
    setVideoEnabled(enabled);
  }

  function toggleAudio() {
    if (!localStream) return;
    const enabled = !audioEnabled;
    localStream.getAudioTracks().forEach((t) => (t.enabled = enabled));
    setAudioEnabled(enabled);
  }

  async function captureAndSendPhoto() {
    const video = localVideoRef.current;
    if (!video || !cryptoKey) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
        sendFile(file);
      },
      "image/jpeg",
      0.85
    );
  }

  function copyLink() {
    const url = new URL(window.location.href);
    url.searchParams.delete("role");
    navigator.clipboard.writeText(url.toString());
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
      <main className="min-h-[100dvh] flex items-center justify-center px-4">
        <div className="max-w-sm w-full space-y-6 animate-fade-in">
          <div className="text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-primary" />
            </div>
            <h2 className="text-xl font-medium tracking-tight">Passphrase Required</h2>
            <p className="text-sm text-muted-foreground">
              This room is protected. Enter the passphrase to join.
            </p>
          </div>
          <div className="space-y-3">
            <Input
              type="password"
              value={passphraseInput}
              onChange={(e) => {
                setPassphraseInput(e.target.value);
                setPassphraseError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && handlePassphraseSubmit()}
              placeholder="Enter passphrase"
              autoFocus
              className="h-11"
            />
            {passphraseError && (
              <p className="text-sm text-destructive text-center">{passphraseError}</p>
            )}
            <Button
              onClick={handlePassphraseSubmit}
              disabled={unlocking || !passphraseInput}
              className="w-full h-11 min-h-[44px]"
            >
              {unlocking ? "Decrypting..." : "Enter Room"}
            </Button>
          </div>
        </div>
      </main>
    );
  }

  if (!cryptoKey) {
    return (
      <main className="min-h-[100dvh] flex items-center justify-center px-4">
        <div className="text-center space-y-3">
          <h2 className="text-xl font-medium tracking-tight">Invalid room link</h2>
          <p className="text-sm text-muted-foreground">
            The encryption key is missing from the URL. Ask for a new link.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="h-[100dvh] flex flex-col">
      {/* Header */}
      <header
        className="flex-shrink-0 border-b border-border px-3 sm:px-4 py-2.5 sm:py-3 select-none"
        style={{ paddingTop: "max(0.625rem, env(safe-area-inset-top))" }}
      >
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-base font-semibold tracking-tight shrink-0 hidden min-[360px]:inline">whispr</span>
            <StatusBadge state={connectionState} />
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {inCall && (
              <div className="items-center gap-1.5 text-xs text-whispr-red hidden sm:flex">
                <span className="w-1.5 h-1.5 rounded-full bg-whispr-red animate-pulse" />
                <Video className="w-3.5 h-3.5" />
              </div>
            )}
            {isPassphraseProtected && (
              <Lock className="w-3.5 h-3.5 text-muted-foreground hidden sm:block" />
            )}
            {isCreator && connectionState === "waiting" && (
              <Button variant="ghost" size="sm" onClick={copyLink} className="gap-1.5 min-h-[44px] min-w-[44px]">
                {linkCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{linkCopied ? "Copied" : "Copy Link"}</span>
              </Button>
            )}
            {connectionState === "disconnected" && (
              <Button variant="ghost" size="sm" onClick={reconnect} className="gap-1.5 min-h-[44px] min-w-[44px]">
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Reconnect</span>
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowWarning(true)}
              className="gap-1.5 min-h-[44px] min-w-[44px] text-whispr-red hover:text-whispr-red hover:bg-whispr-red/10"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Leave</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Video call area */}
      {inCall && (
        <div className="flex-shrink-0 px-3 sm:px-4 py-2">
          <div className="max-w-2xl mx-auto relative rounded-xl overflow-hidden bg-black aspect-video">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              webkit-playsinline=""
              className="w-full h-full object-cover"
            />
            {!remoteStream && (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
                Waiting for peer video...
              </div>
            )}
            {/* Local PiP */}
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              webkit-playsinline=""
              muted
              className="absolute bottom-3 right-3 w-24 sm:w-32 aspect-video rounded-lg object-cover border border-white/10 bg-black"
            />
            {/* Pill-shaped controls toolbar */}
            <div className="absolute bottom-3 left-3 flex items-center gap-1 bg-black/60 backdrop-blur-md rounded-full p-1.5 select-none">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleAudio}
                className={cn(
                  "w-11 h-11 min-w-[44px] min-h-[44px] rounded-full border-none",
                  audioEnabled ? "text-white hover:bg-white/10" : "bg-whispr-red text-white hover:bg-whispr-red/80"
                )}
              >
                {audioEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleVideo}
                className={cn(
                  "w-11 h-11 min-w-[44px] min-h-[44px] rounded-full border-none",
                  videoEnabled ? "text-white hover:bg-white/10" : "bg-whispr-red text-white hover:bg-whispr-red/80"
                )}
              >
                {videoEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={captureAndSendPhoto}
                className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full border-none text-white hover:bg-white/10"
              >
                <Camera className="w-5 h-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={stopVideoCall}
                className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full border-none bg-whispr-red text-white hover:bg-whispr-red/80"
              >
                <PhoneOff className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Messages area */}
      <div
        className="flex-1 overflow-y-auto px-3 sm:px-4 pb-4 scroll-smooth overscroll-contain"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <div className="max-w-2xl mx-auto space-y-3 pt-4">
          {/* Waiting state */}
          {connectionState === "waiting" && (
            <div className="flex flex-col items-center justify-center py-20 space-y-4 animate-fade-in">
              <p className="text-sm text-muted-foreground animate-pulse-glow">
                Waiting for peer to join...
              </p>
              {isCreator && (
                <Button variant="ghost" size="sm" onClick={copyLink} className="gap-1.5">
                  {linkCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {linkCopied ? "Link copied" : "Copy room link"}
                </Button>
              )}
              <p className="text-xs text-muted-foreground/50 max-w-xs text-center">
                Share the link to invite someone. The encryption key is embedded in the URL.
              </p>
            </div>
          )}

          {/* Connecting state */}
          {connectionState === "connecting" && (
            <div className="flex items-center justify-center py-20 animate-fade-in">
              <span className="text-sm text-whispr-amber">Establishing secure connection...</span>
            </div>
          )}

          {/* Connected, no messages yet */}
          {connectionState === "connected" && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 animate-fade-in">
              <div className="flex items-center gap-2 text-sm text-whispr-green mb-2">
                <Lock className="w-3.5 h-3.5" />
                Connected securely
              </div>
              <p className="text-xs text-muted-foreground">
                Messages are end-to-end encrypted and vanish when you close this tab.
              </p>
            </div>
          )}

          {/* Disconnected state */}
          {connectionState === "disconnected" && (
            <div className="flex flex-col items-center justify-center py-20 space-y-4 animate-fade-in">
              <p className="text-sm text-muted-foreground">Connection ended</p>
              <div className="flex gap-3">
                <Button onClick={reconnect} className="gap-1.5">
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reconnect
                </Button>
                <Button variant="ghost" onClick={() => setShowWarning(true)}>
                  Leave
                </Button>
              </div>
            </div>
          )}

          {/* Message list */}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex animate-fade-in",
                msg.sender === "me" ? "justify-end" : "justify-start"
              )}
            >
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-4 py-2.5",
                  msg.sender === "me"
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-card border border-border rounded-bl-md"
                )}
              >
                {msg.type === "text" && (
                  <p className="text-sm whitespace-pre-wrap break-words">{msg.text}</p>
                )}

                {msg.type === "image" && msg.fileUrl && (
                  <div className="space-y-1.5">
                    <img
                      src={msg.fileUrl}
                      alt={msg.fileName}
                      className="max-w-full rounded-lg max-h-64 object-contain w-auto h-auto"
                    />
                    <p className="text-xs opacity-60 break-all">{msg.fileName}</p>
                  </div>
                )}

                {msg.type === "file-meta" && (
                  <a
                    href={msg.fileUrl}
                    download={msg.fileName}
                    className="flex items-center gap-2 text-sm hover:underline"
                  >
                    <FileIcon className="w-4 h-4 shrink-0" />
                    <div>
                      <div className="break-all">{msg.fileName}</div>
                      <div className="text-xs opacity-60">
                        {formatSize(msg.fileSize ?? 0)}
                      </div>
                    </div>
                  </a>
                )}

                <div
                  className={cn(
                    "text-[10px] mt-1",
                    msg.sender === "me"
                      ? "text-primary-foreground/50"
                      : "text-muted-foreground"
                  )}
                >
                  {formatTime(msg.timestamp)}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input bar */}
      <div
        className="flex-shrink-0 border-t border-border px-3 sm:px-4 py-2.5 sm:py-3 select-none"
        style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
      >
        <div className="max-w-2xl mx-auto flex items-center gap-1.5 sm:gap-2">
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
          <Button
            variant="ghost"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={connectionState !== "connected"}
            className="min-w-[44px] min-h-[44px]"
          >
            <Paperclip className="w-4 h-4" />
          </Button>
          {!inCall && connectionState === "connected" && (
            <Button
              variant="ghost"
              size="icon"
              onClick={startVideoCall}
              className="min-w-[44px] min-h-[44px]"
            >
              <Video className="w-4 h-4" />
            </Button>
          )}
          <Input
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
            autoComplete="off"
            className="flex-1 h-11"
          />
          <Button
            size="icon"
            onClick={sendMessage}
            disabled={connectionState !== "connected" || !input.trim()}
            className="min-w-[44px] min-h-[44px]"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Leave warning modal */}
      {showWarning && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-card border border-border rounded-xl p-6 max-w-sm w-full space-y-4 animate-fade-in">
            <h3 className="text-lg font-medium tracking-tight">Leave room?</h3>
            <p className="text-sm text-muted-foreground">
              All messages will be permanently destroyed. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <Button
                variant="ghost"
                className="flex-1 min-h-[44px]"
                onClick={() => setShowWarning(false)}
              >
                Stay
              </Button>
              <Button
                variant="destructive"
                className="flex-1 min-h-[44px]"
                onClick={() => window.close()}
              >
                Leave & Destroy
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function StatusBadge({ state }: { state: ConnectionState }) {
  const config = {
    idle: { dotColor: "bg-muted-foreground", label: "Initializing" },
    waiting: { dotColor: "bg-whispr-amber", label: "Waiting" },
    connecting: { dotColor: "bg-whispr-amber", label: "Connecting" },
    connected: { dotColor: "bg-whispr-green", label: "Connected" },
    disconnected: { dotColor: "bg-whispr-red", label: "Disconnected" },
  }[state];

  return (
    <Badge variant="outline" className="gap-1.5 font-normal py-1">
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full",
          config.dotColor,
          (state === "waiting" || state === "connecting") && "animate-pulse"
        )}
      />
      {config.label}
    </Badge>
  );
}
