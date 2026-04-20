const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export async function getIceServers(): Promise<RTCIceServer[]> {
  try {
    const res = await fetch("/api/turn");
    if (!res.ok) throw new Error(`TURN API returned ${res.status}`);
    const data = await res.json();
    // Cloudflare returns iceServers as a single object, not an array
    const servers = Array.isArray(data.iceServers)
      ? data.iceServers
      : data.iceServers
      ? [data.iceServers]
      : [];
    if (servers.length === 0) throw new Error("Empty iceServers response");
    return servers;
  } catch (e) {
    console.warn("Failed to fetch TURN servers, falling back to STUN:", e);
    return FALLBACK_ICE_SERVERS;
  }
}

export type ConnectionState =
  | "idle"
  | "waiting"
  | "connecting"
  | "connected"
  | "disconnected";

export interface PeerCallbacks {
  onMessage: (data: string) => void;
  onBinaryMessage: (data: ArrayBuffer) => void;
  onStateChange: (state: ConnectionState) => void;
}

export function createPeerConnection(
  callbacks: PeerCallbacks,
  iceServers: RTCIceServer[]
): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers });

  // Only use PC state for failure detection.
  // "connected" is driven by dc.onopen so the UI only shows
  // "Connected" once the data channel is actually usable.
  pc.onconnectionstatechange = () => {
    switch (pc.connectionState) {
      case "failed":
      case "closed":
        callbacks.onStateChange("disconnected");
        break;
    }
  };

  return pc;
}

export function createDataChannel(
  pc: RTCPeerConnection,
  callbacks: PeerCallbacks
): RTCDataChannel {
  const dc = pc.createDataChannel("whispr", { ordered: true });
  dc.binaryType = "arraybuffer";
  setupDataChannel(dc, callbacks);
  return dc;
}

export function setupDataChannel(
  dc: RTCDataChannel,
  callbacks: PeerCallbacks
): void {
  dc.binaryType = "arraybuffer";
  dc.onmessage = (e) => {
    if (typeof e.data === "string") {
      callbacks.onMessage(e.data);
    } else {
      callbacks.onBinaryMessage(e.data as ArrayBuffer);
    }
  };
  dc.onopen = () => callbacks.onStateChange("connected");
  dc.onclose = () => callbacks.onStateChange("disconnected");
}

export async function createOffer(
  pc: RTCPeerConnection
): Promise<RTCSessionDescriptionInit> {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceGathering(pc);
  return pc.localDescription!;
}

export async function createAnswer(
  pc: RTCPeerConnection,
  offer: RTCSessionDescriptionInit
): Promise<RTCSessionDescriptionInit> {
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIceGathering(pc);
  return pc.localDescription!;
}

export async function acceptAnswer(
  pc: RTCPeerConnection,
  answer: RTCSessionDescriptionInit
): Promise<void> {
  await pc.setRemoteDescription(new RTCSessionDescription(answer));
}

export function addMediaStream(
  pc: RTCPeerConnection,
  stream: MediaStream
): void {
  for (const track of stream.getTracks()) {
    pc.addTrack(track, stream);
  }
}

export function removeMediaTracks(pc: RTCPeerConnection): void {
  for (const sender of pc.getSenders()) {
    if (sender.track) {
      sender.track.stop();
      pc.removeTrack(sender);
    }
  }
}

export function setupRenegotiation(
  pc: RTCPeerConnection,
  onOffer: (offer: RTCSessionDescriptionInit) => void
): void {
  let negotiating = false;
  pc.onnegotiationneeded = async () => {
    if (negotiating) return;
    negotiating = true;
    try {
      const offer = await createOffer(pc);
      onOffer(offer);
    } catch (e) {
      console.error("Renegotiation failed:", e);
    } finally {
      negotiating = false;
    }
  };
}

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timeout);
      pc.onicegatheringstatechange = null;
      resolve();
    };
    const timeout = setTimeout(done, 3000);
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") {
        done();
      }
    };
  });
}
