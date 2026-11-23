/**
 * Dice sources for the authoritative online engine.
 *
 * The engine never stores a seed or PRNG state in match state, so neither a persisted snapshot
 * nor a player view can be used to predict future dice (see DECISIONS D-004 / D-010).
 */
export interface DiceSource {
  /** Uniform integer in 1..6. */
  rollDie(): number;
}

type FillRandom = (buffer: Uint8Array) => Uint8Array;

/**
 * Production source: Web Crypto CSPRNG (available in browsers, Node ≥ 19 and Workers runtimes).
 * Uses rejection sampling: bytes 252..255 are discarded so that 252 = 6 × 42 keeps every face exactly uniform.
 */
export function cryptoDiceSource(fill?: FillRandom): DiceSource {
  const getRandom: FillRandom =
    fill ??
    ((buffer) => {
      // Same Web Crypto API in browsers, Node and the Workers runtime (typed loosely for all three).
      const webCrypto = (globalThis as { crypto?: { getRandomValues<T extends Uint8Array>(array: T): T } }).crypto;
      if (!webCrypto?.getRandomValues) throw Error("CSPRNG(crypto.getRandomValues)를 사용할 수 없습니다.");
      return webCrypto.getRandomValues(buffer);
    });
  const buffer = new Uint8Array(64);
  let index = buffer.length;
  return {
    rollDie() {
      for (let guard = 0; guard < 1 << 16; guard++) {
        if (index >= buffer.length) {
          getRandom(buffer);
          index = 0;
        }
        const byte = buffer[index++];
        if (byte < 252) return 1 + (byte % 6);
      }
      throw Error("난수 공급원이 균등한 값을 반환하지 않습니다.");
    },
  };
}

/** Deterministic source for tests and local simulations only. Never use for real online matches. */
export function seededDiceSource(seed: number): DiceSource {
  let state = seed >>> 0 || 0x9e3779b9;
  return {
    rollDie() {
      // xorshift32 + rejection to stay uniform.
      for (;;) {
        state ^= state << 13;
        state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        const value = state & 0xff;
        if (value < 252) return 1 + (value % 6);
      }
    },
  };
}

/** Scripted source for tests: returns the listed faces in order. */
export function scriptedDiceSource(faces: number[]): DiceSource {
  let index = 0;
  return {
    rollDie() {
      if (index >= faces.length) throw Error("준비된 주사위 값이 부족합니다.");
      const face = faces[index++];
      if (!Number.isInteger(face) || face < 1 || face > 6) throw Error("주사위 값은 1~6이어야 합니다.");
      return face;
    },
  };
}
