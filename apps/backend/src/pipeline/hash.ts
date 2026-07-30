// Perceptual image hashing for dedupe. Uses dHash (difference hash): resize to
// 9x8 grayscale, compare horizontally-adjacent pixels → 64-bit signature.
// Robust to scaling/compression; Hamming distance measures similarity.
import sharp from "sharp";

export async function dhash(file: string): Promise<bigint> {
  const w = 9;
  const h = 8;
  const buf = await sharp(file)
    .grayscale()
    .resize(w, h, { fit: "fill" })
    .raw()
    .toBuffer();
  let bits = 0n;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) {
      const left = buf[y * w + x];
      const right = buf[y * w + x + 1];
      bits = (bits << 1n) | (left < right ? 1n : 0n);
    }
  }
  return bits; // 64 bits
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}
