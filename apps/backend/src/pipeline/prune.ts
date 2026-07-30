// Stage 1 — Prune: drop images whose smaller side is below the min dimension.
// Runs locally. source/ → work/00_pruned/.
import sharp from "sharp";
import { copyFileSync } from "fs";
import { basename, join } from "path";
import { paths, listImages, type Project } from "../projects.ts";

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
  let kept = 0;
  for (const file of imgs) {
    try {
      const meta = await sharp(file).metadata();
      const w = meta.width ?? 0;
      const h = meta.height ?? 0;
      if (Math.min(w, h) >= minDim) {
        copyFileSync(file, join(outDir, basename(file)));
        kept++;
      }
    } catch {
      // unreadable image → treat as pruned
    }
  }
  return { total: imgs.length, kept, pruned: imgs.length - kept, minDim };
}
