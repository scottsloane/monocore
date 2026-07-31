// Stage 2 — Dedupe: drop near-duplicate images by perceptual (dHash) similarity.
// Runs locally. work/00_pruned/ → work/01_deduped/. Greedy: keep the first of
// each cluster, skip anything within `threshold` Hamming distance of a kept image.
import { copyFileSync } from "fs";
import { basename, join } from "path";
import { paths, listImages, type Project } from "../projects.ts";
import { dhash, hamming } from "./hash.ts";
import { mapLimit } from "./concurrency.ts";

export type DedupeResult = {
  total: number;
  kept: number;
  removed: number;
  threshold: number;
};

export async function dedupe(
  project: Project,
  threshold: number,
): Promise<DedupeResult> {
  const p = paths(project.id);
  const inDir = p.workDir("00_pruned");
  const outDir = p.workDir("01_deduped");
  const imgs = listImages(inDir);

  // Hash all images in parallel (the expensive part), then greedily cluster in a
  // stable serial pass so the kept set is deterministic regardless of timing.
  const hashes = await mapLimit(imgs, 8, async (file) => {
    try {
      return await dhash(file);
    } catch {
      return null;
    }
  });

  const keptHashes: bigint[] = [];
  let kept = 0;
  for (let i = 0; i < imgs.length; i++) {
    const h = hashes[i];
    if (h === null) continue;
    if (keptHashes.some((k) => hamming(h, k) <= threshold)) continue;
    keptHashes.push(h);
    copyFileSync(imgs[i], join(outDir, basename(imgs[i])));
    kept++;
  }
  return { total: imgs.length, kept, removed: imgs.length - kept, threshold };
}
