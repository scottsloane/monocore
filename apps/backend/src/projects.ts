// Project lifecycle: folder scaffold, source-image copy, and persistence.
// A project owns a folder holding all its files; the selected input folder is
// never modified (images are copied out of it).
import {
  mkdirSync,
  copyFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
} from "fs";
import { join, extname, basename } from "path";
import { config } from "./config.ts";
import { db } from "./db.ts";
import {
  resolveDefaults,
  BASE_MODELS,
  TRAIN_TYPES,
  type BaseModel,
  type TrainType,
  type Settings,
} from "./defaults.ts";

const IMAGE_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".bmp",
  ".tiff",
  ".tif",
  ".avif",
]);

export const WORK_SUBDIRS = [
  "00_pruned",
  "01_deduped",
  "02_quality",
  "03_subject",
  "04_cropped",
  "05_captioned",
] as const;

export type Project = {
  id: string;
  name: string;
  baseModel: BaseModel;
  trainType: TrainType;
  subject: string; // what the LoRA depicts (drives subject-match + crop)
  status: string;
  settings: Settings;
  source: { inputFolder: string; imageCount: number };
  stages: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export function projectDir(id: string) {
  return join(config.dataDir, id);
}

export function paths(id: string) {
  const dir = projectDir(id);
  return {
    dir,
    source: join(dir, "source"),
    work: join(dir, "work"),
    workDir: (sub: (typeof WORK_SUBDIRS)[number]) => join(dir, "work", sub),
    dataset: join(dir, "dataset"),
    output: join(dir, "output"),
    logs: join(dir, "logs"),
    configFile: join(dir, "project.json"),
  };
}

export function listImages(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()))
    .map((f) => join(dir, f));
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "project"
  );
}

function persist(p: Project) {
  writeFileSync(paths(p.id).configFile, JSON.stringify(p, null, 2));
  db.query(
    `INSERT INTO projects (id, name, base_model, train_type, status, config_json, created_at, updated_at)
     VALUES ($id, $name, $base, $type, $status, $cfg, $created, $updated)
     ON CONFLICT(id) DO UPDATE SET
       name=$name, base_model=$base, train_type=$type, status=$status,
       config_json=$cfg, updated_at=$updated`,
  ).run({
    $id: p.id,
    $name: p.name,
    $base: p.baseModel,
    $type: p.trainType,
    $status: p.status,
    $cfg: JSON.stringify(p),
    $created: p.createdAt,
    $updated: p.updatedAt,
  });
}

export function saveProject(p: Project) {
  p.updatedAt = new Date().toISOString();
  persist(p);
  return p;
}

export type CreateInput = {
  name: string;
  baseModel: BaseModel;
  trainType: TrainType;
  inputFolder: string;
  subject?: string;
};

export function createProject(input: CreateInput): Project {
  const { name, baseModel, trainType, inputFolder } = input;
  if (!BASE_MODELS.includes(baseModel))
    throw new Error(`invalid baseModel: ${baseModel}`);
  if (!TRAIN_TYPES.includes(trainType))
    throw new Error(`invalid trainType: ${trainType}`);
  if (!existsSync(inputFolder))
    throw new Error(`input folder not found: ${inputFolder}`);

  const id = `${slug(name)}-${crypto.randomUUID().slice(0, 6)}`;
  const p = paths(id);
  for (const dir of [p.source, p.dataset, p.output, p.logs])
    mkdirSync(dir, { recursive: true });
  for (const sub of WORK_SUBDIRS) mkdirSync(p.workDir(sub), { recursive: true });

  // copy source images (source folder stays untouched)
  const imgs = listImages(inputFolder);
  for (const src of imgs) copyFileSync(src, join(p.source, basename(src)));

  const now = new Date().toISOString();
  const project: Project = {
    id,
    name,
    baseModel,
    trainType,
    subject: input.subject?.trim() ?? "",
    status: "created",
    settings: resolveDefaults(baseModel, trainType),
    source: { inputFolder, imageCount: imgs.length },
    stages: {},
    createdAt: now,
    updatedAt: now,
  };
  persist(project);
  return project;
}

export function getProject(id: string): Project | null {
  const row = db
    .query(`SELECT config_json FROM projects WHERE id = $id`)
    .get({ $id: id }) as { config_json: string } | null;
  return row ? (JSON.parse(row.config_json) as Project) : null;
}

export function listProjects(): Project[] {
  const rows = db
    .query(`SELECT config_json FROM projects ORDER BY created_at DESC`)
    .all() as { config_json: string }[];
  return rows.map((r) => JSON.parse(r.config_json) as Project);
}
