"use client";

import { useRouter } from "next/navigation";
import {
  generateKey,
  exportKey,
  deriveKeyFromPassphrase,
  encryptRoomKey,
} from "@/lib/crypto";
import { useState } from "react";

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
    <main className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full space-y-8 text-center">
        <div className="space-y-3">
          <h1 className="text-4xl font-semibold tracking-tight">
            whispr
          </h1>
          <p className="text-whispr-muted text-sm leading-relaxed">
            Encrypted peer-to-peer ephemeral chat.
            <br />
            No servers. No logs. No traces.
          </p>
        </div>

        <div className="space-y-4">
          <div className="bg-whispr-surface border border-whispr-border rounded-lg p-4 space-y-3 text-left">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm text-whispr-text flex items-center gap-2">
                <ShieldIcon />
                Set passphrase
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={usePassphrase}
                onClick={() => {
                  setUsePassphrase(!usePassphrase);
                  if (usePassphrase) setPassphrase("");
                }}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  usePassphrase ? "bg-whispr-accent" : "bg-whispr-border"
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
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Enter a passphrase"
                  className="w-full bg-whispr-bg border border-whispr-border rounded-lg px-3 py-2 text-sm
                             placeholder:text-whispr-muted/50 focus:outline-none focus:border-whispr-accent/50
                             transition-colors"
                />
                <p className="text-[11px] text-whispr-muted">
                  Recipients will need this passphrase to enter the room. The passphrase is never included in the link.
                </p>
              </div>
            )}
          </div>

          <button
            onClick={handleCreate}
            disabled={creating || (usePassphrase && passphrase.length < 1)}
            className="w-full py-3.5 px-6 bg-whispr-accent hover:bg-whispr-accent/90 disabled:opacity-50
                       rounded-lg text-white font-medium transition-all duration-200
                       focus:outline-none focus:ring-2 focus:ring-whispr-accent/50"
          >
            {creating ? "Creating room..." : "Create Private Room"}
          </button>
        </div>

        <div className="pt-4 space-y-3">
          <div className="flex items-center justify-center gap-2 text-xs text-whispr-muted">
            <LockIcon />
            <span>End-to-end encrypted &bull; P2P &bull; Zero server storage</span>
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs text-whispr-muted">
            <div className="bg-whispr-surface rounded-lg p-3 border border-whispr-border">
              <div className="text-whispr-text font-medium mb-1">Encrypted</div>
              <div>AES-256-GCM on top of DTLS</div>
            </div>
            <div className="bg-whispr-surface rounded-lg p-3 border border-whispr-border">
              <div className="text-whispr-text font-medium mb-1">Ephemeral</div>
              <div>Messages vanish on tab close</div>
            </div>
            <div className="bg-whispr-surface rounded-lg p-3 border border-whispr-border">
              <div className="text-whispr-text font-medium mb-1">Peer-to-Peer</div>
              <div>Direct connection, no relay</div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function LockIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    </svg>
  );
}
