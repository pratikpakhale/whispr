import { NextRequest, NextResponse } from "next/server";

let kv: { get: (key: string) => Promise<string | null>; set: (key: string, value: string, options?: { ex?: number }) => Promise<void> } | null = null;
const memoryStore = new Map<string, { value: string; expires: number }>();

async function getStore() {
  if (kv) return kv;

  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const vercelKv = await import("@vercel/kv");
      kv = vercelKv.kv as unknown as typeof kv;
      return kv;
    } catch {
      // fall through to in-memory
    }
  }

  kv = {
    async get(key: string) {
      const entry = memoryStore.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expires) {
        memoryStore.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(key: string, value: string, options?: { ex?: number }) {
      const ttl = (options?.ex ?? 120) * 1000;
      memoryStore.set(key, { value, expires: Date.now() + ttl });
    },
  };
  return kv;
}

export async function POST(req: NextRequest) {
  try {
    const { roomId, role, data } = await req.json();
    if (!roomId || !role || !data) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    if (role !== "offer" && role !== "answer") {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const store = await getStore();
    const key = `whispr:${roomId}:${role}`;
    await store!.set(key, data, { ex: 120 });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const roomId = searchParams.get("roomId");
    const role = searchParams.get("role");

    if (!roomId || !role) {
      return NextResponse.json({ error: "Missing params" }, { status: 400 });
    }

    const store = await getStore();
    const key = `whispr:${roomId}:${role}`;
    const data = await store!.get(key);

    if (!data) {
      return NextResponse.json({ data: null }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
