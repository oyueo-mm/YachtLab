import { hmacSha256, sha256, toHex, utf8 } from "./sha256";
import { DAILY_RULES } from "./calendar";

/**
 * Daily dice tape (LIVE-1, D-117).
 *
 * Indexing: the faces are addressed by POSITION, not by how many random numbers were used so far:
 *
 *     face(date, round r = 1..12, roll k = 1..3, die slot j = 0..4)
 *
 * A die that is held simply leaves its (r, k, j) face unused, so every participant meets the same
 * "tape" no matter which dice they kept or which category they filled — the consumption-order
 * problem of a sequential PRNG (one different hold shifts every later number) does not exist.
 * Each rerolled die still receives a fresh, independent, uniform face it has never seen.
 *
 * Secrecy: dayKey = HMAC-SHA256(DAILY_SECRET, "yachtlab/daily/<rules>/<date>"). The secret is a Worker
 * secret; the key never leaves the server until the day is closed (calendar.ts). At day start only a
 * commitment SHA-256("yachtlab/daily-commit/" + hex(dayKey)) is public; after the day it is revealed,
 * anyone can check it against the commitment and replay any attempt (verifyAttempt in game.ts).
 * There is no public seed from which future dice could be computed.
 */
export type DayKey = Uint8Array;

export function deriveDayKey(secret: string, date: string, rules: string = DAILY_RULES): DayKey {
  if (secret.length < 32) throw Error("DAILY_SECRET must be at least 32 characters");
  return hmacSha256(utf8(secret), utf8(`yachtlab/daily/${rules}/${date}`));
}

export const commitmentOf = (key: DayKey) => toHex(sha256(utf8("yachtlab/daily-commit/" + toHex(key))));

/**
 * The five faces of roll `roll` in round `round`, one per die slot. Rejection sampling over HMAC
 * output bytes (bytes 252..255 discarded) keeps every face exactly uniform; an extra counter block
 * is used in the (≈ 10^-30) case that 32 bytes do not yield five accepted bytes.
 */
export function tapeFaces(key: DayKey, round: number, roll: number): number[] {
  if (!Number.isInteger(round) || round < 1 || round > 12 || !Number.isInteger(roll) || roll < 1 || roll > 3) throw Error("잘못된 주사위 위치입니다.");
  const faces: number[] = [];
  for (let block = 0; faces.length < 5; block++) {
    const bytes = hmacSha256(key, utf8(`r${round}/k${roll}/b${block}`));
    for (const byte of bytes) {
      if (byte < 252) faces.push(1 + (byte % 6));
      if (faces.length === 5) break;
    }
  }
  return faces;
}
