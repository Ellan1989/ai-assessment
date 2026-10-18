import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "@/lib/config";
import { MIGRATIONS } from "./migrations";

type DatabaseType = InstanceType<typeof Database>;

// Survive Next.js dev hot reloads.
const globalForDb = globalThis as unknown as { __assessmentDb?: DatabaseType };

export function getDb(): DatabaseType {
  if (globalForDb.__assessmentDb) return globalForDb.__assessmentDb;
  const dbPath = getConfig().databasePath;
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  globalForDb.__assessmentDb = db;
  return db;
}

export function migrate(db: DatabaseType): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const applied = new Set(
    (db.prepare("SELECT id FROM schema_migrations").all() as { id: number }[]).map((r) => r.id),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    const tx = db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(
        m.id,
        m.name,
        new Date().toISOString(),
      );
    });
    tx();
  }
}

/** Test helper — closes and forgets the singleton. */
export function resetDbForTests(): void {
  if (globalForDb.__assessmentDb) {
    globalForDb.__assessmentDb.close();
    delete globalForDb.__assessmentDb;
  }
}
