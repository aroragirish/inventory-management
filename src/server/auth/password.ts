import "server-only";

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  return { salt, passwordHash: derived.toString("hex") };
}

export async function verifyPassword(
  password: string,
  salt: string,
  passwordHash: string,
) {
  const expected = Buffer.from(passwordHash, "hex");
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}
