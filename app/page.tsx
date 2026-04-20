"use client";

import { useRouter } from "next/navigation";
import {
  generateKey,
  exportKey,
  deriveKeyFromPassphrase,
  encryptRoomKey,
} from "@/lib/crypto";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, Shield } from "lucide-react";

export default function Home() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [usePassphrase, setUsePassphrase] = useState(false);
  const [passphrase, setPassphrase] = useState("");

  async function handleCreate() {
    if (usePassphrase && passphrase.length < 1) return;
    setCreating(true);
    try {
      const key = await generateKey();
      const roomId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);

      let fragment: string;
      if (usePassphrase && passphrase) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const passphraseKey = await deriveKeyFromPassphrase(passphrase, salt);
        const encryptedKey = await encryptRoomKey(key, passphraseKey);
        let saltBinary = "";
        for (let i = 0; i < salt.length; i++) {
          saltBinary += String.fromCharCode(salt[i]);
        }
        const saltB64 = btoa(saltBinary)
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
        fragment = `enc:${encryptedKey}:${saltB64}`;
      } else {
        fragment = await exportKey(key);
      }

      router.push(`/room/${roomId}?role=creator#${fragment}`);
    } catch {
      setCreating(false);
    }
  }

  return (
    <main className="min-h-[100dvh] flex flex-col items-center justify-center px-4 py-8">
      <div className="max-w-md w-full space-y-12 text-center">
        <div className="space-y-4">
          <h1 className="text-5xl sm:text-6xl font-semibold tracking-tight">
            whispr
          </h1>
          <p className="text-muted-foreground text-base leading-relaxed max-w-sm mx-auto">
            Private, encrypted, peer-to-peer messaging.
            <br className="hidden sm:block" />
            No servers. No logs. No traces.
          </p>
        </div>

        <div className="space-y-5">
          <div className="text-left space-y-3">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm text-muted-foreground flex items-center gap-2">
                <Shield className="w-3.5 h-3.5" />
                Passphrase protection
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={usePassphrase}
                onClick={() => {
                  setUsePassphrase(!usePassphrase);
                  if (usePassphrase) setPassphrase("");
                }}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors touch-manipulation ${
                  usePassphrase ? "bg-primary" : "bg-whispr-border"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                    usePassphrase ? "translate-x-[18px]" : "translate-x-[3px]"
                  }`}
                />
              </button>
            </label>

            {usePassphrase && (
              <div className="space-y-2 animate-fade-in">
                <Input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Enter a passphrase"
                  className="h-11"
                />
                <p className="text-xs text-muted-foreground">
                  Recipients will need this passphrase to enter the room.
                </p>
              </div>
            )}
          </div>

          <Button
            onClick={handleCreate}
            disabled={creating || (usePassphrase && passphrase.length < 1)}
            className="w-full h-12 text-sm font-medium"
          >
            {creating ? "Creating room..." : "Create a private room"}
          </Button>
        </div>

        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Lock className="w-3 h-3" />
          <span>E2E encrypted · P2P · No accounts · No logs</span>
        </div>
      </div>
    </main>
  );
}
