// HMAC-SHA256 signing and verification for Deepgram callback URLs.
// Both transcribe-audio (signing) and transcribe-callback (verifying) use this.
// Uses the Deno Web Crypto API — no npm dependency.

const encoder = new TextEncoder();

async function importKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function bytesToBase64Url(bytes: ArrayBuffer): string {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const b64 = padded + "===".slice((padded.length + 3) % 4);
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

/** Produce a base64url-encoded HMAC-SHA256 of `jobId:partIndex` with `secret`. */
export async function signCallbackToken(
  secret: string,
  jobId: string,
  partIndex: number,
): Promise<string> {
  const key = await importKey(secret);
  const message = `${jobId}:${partIndex}`;
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return bytesToBase64Url(sig);
}

/** Constant-time verification. Returns true iff the token is valid for (jobId, partIndex). */
export async function verifyCallbackToken(
  secret: string,
  jobId: string,
  partIndex: number,
  presentedToken: string,
): Promise<boolean> {
  if (!presentedToken) return false;
  const key = await importKey(secret);
  const message = `${jobId}:${partIndex}`;
  let presented: Uint8Array;
  try {
    presented = base64UrlToBytes(presentedToken);
  } catch {
    return false;
  }
  return await crypto.subtle.verify("HMAC", key, presented, encoder.encode(message));
}
