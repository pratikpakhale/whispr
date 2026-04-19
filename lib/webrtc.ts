const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

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
  callbacks: PeerCallbacks
): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  pc.onconnectionstatechange = () => {
    switch (pc.connectionState) {
      case "connected":
        callbacks.onStateChange("connected");
        break;
      case "disconnected":
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

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, 3000);
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timeout);
        resolve();
      }
    };
  });
}
