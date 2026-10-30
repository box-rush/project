import { sha256 } from "@noble/hashes/sha2";
import { hmac } from "@noble/hashes/hmac";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

/** H(x) = SHA-256(UTF-8 bytes of x) as lowercase hex (§10.4.1). Isomorphic: server, browser, verifier. */
export function H(x: string): string {
  return bytesToHex(sha256(utf8ToBytes(x)));
}

export function hmacSha256Hex(keyHex: string, message: string): string {
  return bytesToHex(hmac(sha256, hexToBytes(keyHex), utf8ToBytes(message)));
}

export { bytesToHex, hexToBytes };
