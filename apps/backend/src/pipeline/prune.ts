// Stage 1 — Prune: drop images whose smaller side is below the min dimension.
// Runs locally. source/ → work/00_pruned/.
import sharp from "sharp";
import { copyFileSync } from "fs";
import { basename, join } from "path";
import { paths, listImages, type Project } from "../projects.ts";
import { mapLimit } from "./concurrency.ts";

export type PruneResult = {
  total: number;
  kept: number;
  pruned: number;
  minDim: number;
};

export async function prune(
  project: Project,
  minDim: number,
): Promise<PruneResult> {
  const p = paths(project.id);
  const outDir = p.workDir("00_pruned");
  const imgs = listImages(p.source);
  // read metadata (and copy the keepers) in parallel — IO/CPU bound per image
  const keeps = await mapLimit(imgs, 8, async (file) => {
    try {
      const meta = await sharp(file).metadata();
      if (Math.min(meta.width ?? 0, meta.height ?? 0) >= minDim) {
        copyFileSync(file, join(outDir, basename(file)));
        return true;
      }
    } catch {
      // unreadable image → treat as pruned
    }
    return false;
  });
  const kept = keeps.filter(Boolean).length;
  return { total: imgs.length, kept, pruned: imgs.length - kept, minDim };
}
