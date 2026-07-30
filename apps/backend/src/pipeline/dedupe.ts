// Stage 2 — Dedupe: drop near-duplicate images by perceptual (dHash) similarity.
// Runs locally. work/00_pruned/ → work/01_deduped/. Greedy: keep the first of
// each cluster, skip anything within `threshold` Hamming distance of a kept image.
import { copyFileSync } from "fs";
import { basename, join } from "path";
import { paths, listImages, type Project } from "../projects.ts";
import { dhash, hamming } from "./hash.ts";

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

  const keptHashes: bigint[] = [];
  let kept = 0;
  for (const file of imgs) {
    let h: bigint;
    try {
      h = await dhash(file);
    } catch {
      continue;
    }
    if (keptHashes.some((k) => hamming(h, k) <= threshold)) continue;
    keptHashes.push(h);
    copyFileSync(file, join(outDir, basename(file)));
    kept++;
  }
  return { total: imgs.length, kept, removed: imgs.length - kept, threshold };
}
