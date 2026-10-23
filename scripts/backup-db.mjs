import Database from "better-sqlite3";

/**
 * Consistent SQLite backup (handles WAL mode correctly, safe while the
 * server is running). Usage: node scripts/backup-db.mjs <db-path> <dest-path>
 */
const [dbPath, destPath] = process.argv.slice(2);
if (!dbPath || !destPath) {
  console.error("Usage: node scripts/backup-db.mjs <db-path> <dest-path>");
  process.exit(1);
}
const db = new Database(dbPath, { readonly: true });
await db.backup(destPath);
db.close();
console.log("Backup written:", destPath);
