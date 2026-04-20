import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

const memoryStore = new Map<string, { value: string; expires: number }>();

function getStore() {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    return new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  }
  // Local dev fallback (in-memory, single process only)
  return {
    async get(key: string): Promise<string | null> {
      const entry = memoryStore.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expires) {
        memoryStore.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(key: string, value: string, options?: { ex: number }): Promise<void> {
      const ttl = (options?.ex ?? 300) * 1000;
      memoryStore.set(key, { value, expires: Date.now() + ttl });
    },
  };
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

    const store = getStore();
    const key = `whispr:${roomId}:${role}`;
    await store.set(key, data, { ex: 300 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("POST /api/signal error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
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

    const store = getStore();
    const key = `whispr:${roomId}:${role}`;
    const data = await store.get(key);

    if (!data) {
      return NextResponse.json({ data: null }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("GET /api/signal error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
