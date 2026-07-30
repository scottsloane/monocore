// Local state store (SQLite via bun:sqlite). Holds projects and a mirror of
// jobs submitted to the GB10 so status survives UI/app restarts.
import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { join } from "path";
import { config } from "./config.ts";

mkdirSync(config.dataDir, { recursive: true });

export const db = new Database(join(config.dataDir, "monocore.db"), {
  create: true,
});
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    base_model  TEXT,
    train_type  TEXT,
    status      TEXT NOT NULL DEFAULT 'draft',
    config_json TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id          TEXT PRIMARY KEY,
    project_id  TEXT,
    stage       TEXT NOT NULL,
    status      TEXT NOT NULL,
    remote_id   TEXT,
    exit_code   INTEGER,
    created_at  TEXT NOT NULL,
    finished_at TEXT
  );
`);

export type JobRow = {
  id: string;
  project_id: string | null;
  stage: string;
  status: string;
  remote_id: string | null;
  exit_code: number | null;
  created_at: string;
  finished_at: string | null;
};

export function insertJob(row: JobRow) {
  db.query(
    `INSERT INTO jobs (id, project_id, stage, status, remote_id, exit_code, created_at, finished_at)
     VALUES ($id, $project_id, $stage, $status, $remote_id, $exit_code, $created_at, $finished_at)`,
  ).run({
    $id: row.id,
    $project_id: row.project_id,
    $stage: row.stage,
    $status: row.status,
    $remote_id: row.remote_id,
    $exit_code: row.exit_code,
    $created_at: row.created_at,
    $finished_at: row.finished_at,
  });
}

export function updateJob(
  id: string,
  patch: Partial<Pick<JobRow, "status" | "exit_code" | "finished_at">>,
) {
  const sets: string[] = [];
  const params: Record<string, string | number | null> = { $id: id };
  for (const [k, v] of Object.entries(patch)) {
    sets.push(`${k} = $${k}`);
    params[`$${k}`] = v as string | number | null;
  }
  if (!sets.length) return;
  db.query(`UPDATE jobs SET ${sets.join(", ")} WHERE id = $id`).run(params);
}

export function getJob(id: string): JobRow | null {
  return db.query(`SELECT * FROM jobs WHERE id = $id`).get({ $id: id }) as
    | JobRow
    | null;
}
