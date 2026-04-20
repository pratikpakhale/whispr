export type SignalRole = "offer" | "answer";

/** Posts an encrypted signaling message (offer or answer) to the server. */
export async function sendSignal(
  roomId: string,
  role: SignalRole,
  data: string
): Promise<void> {
  const res = await fetch("/api/signal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId, role, data }),
  });
  if (!res.ok) throw new Error(`Signal send failed: ${res.status}`);
}

/** Clears all signaling data for a room. */
export async function clearSignals(roomId: string): Promise<void> {
  await fetch(`/api/signal?roomId=${encodeURIComponent(roomId)}`, { method: "DELETE" });
}

/** Polls for a signaling message by room and role, returns null if not found. */
export async function pollSignal(
  roomId: string,
  role: SignalRole
): Promise<string | null> {
  const res = await fetch(
    `/api/signal?roomId=${encodeURIComponent(roomId)}&role=${role}`
  );
  if (!res.ok) return null;
  const json = await res.json();
  return json.data ?? null;
}
