import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = scryptSync(password, salt, KEY_LENGTH);
  return {
    hash: derivedKey.toString("hex"),
    salt,
  };
}

export function verifyPassword(password, hash, salt) {
  try {
    const derivedKey = scryptSync(password, salt, KEY_LENGTH);
    const keyBuffer = Buffer.from(derivedKey);
    const hashBuffer = Buffer.from(hash, "hex");
    if (keyBuffer.length !== hashBuffer.length) {
      return false;
    }
    return timingSafeEqual(keyBuffer, hashBuffer);
  } catch {
    return false;
  }
}

export function generateToken() {
  return randomBytes(32).toString("hex");
}
