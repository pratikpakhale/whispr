import { NextResponse } from "next/server";

export async function GET() {
  const tokenId = process.env.CLOUDFLARE_TURN_TOKEN_ID;
  const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;

  if (!tokenId || !apiToken) {
    return NextResponse.json(
      { error: "TURN credentials not configured" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${tokenId}/credentials/generate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: 86400 }),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      console.error("Cloudflare TURN error:", res.status, text);
      return NextResponse.json(
        { error: "Failed to generate TURN credentials" },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json({ iceServers: data.iceServers });
  } catch (e) {
    console.error("TURN credential fetch failed:", e);
    return NextResponse.json(
      { error: "Failed to reach TURN service" },
      { status: 502 }
    );
  }
}
