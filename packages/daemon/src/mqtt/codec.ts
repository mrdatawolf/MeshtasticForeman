import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv } from "node:crypto";

export const DEFAULT_KEY = Buffer.from("1PG7OiApB1nwvP+rz05pAQ==", "base64");

export function expandPsk(psk: Uint8Array): Buffer {
  if (psk.length === 1 && psk[0] === 0x01) return DEFAULT_KEY;
  if (psk.length === 16 || psk.length === 32) return Buffer.from(psk);
  return Buffer.from(psk).subarray(0, 16).equals(Buffer.alloc(16))
    ? DEFAULT_KEY
    : Buffer.concat([Buffer.from(psk), Buffer.alloc(16)]).subarray(0, 16);
}

export function decrypt(
  key: Buffer,
  packetId: number,
  fromNode: number,
  ciphertext: Buffer,
): Buffer {
  const nonce = Buffer.alloc(16);
  nonce.writeUInt32LE(packetId >>> 0, 0);
  nonce.writeUInt32LE(fromNode >>> 0, 8);
  const decipher = createDecipheriv("aes-128-ctr", key, nonce);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function encrypt(
  key: Buffer,
  packetId: number,
  fromNode: number,
  plaintext: Buffer,
): Buffer {
  // Nonce: packetId as uint64 LE (upper 4 bytes = 0) + fromNode as uint64 LE
  const nonce = Buffer.alloc(16);
  nonce.writeUInt32LE(packetId >>> 0, 0);
  nonce.writeUInt32LE(fromNode >>> 0, 8);
  const cipher = createCipheriv("aes-128-ctr", key, nonce);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}
