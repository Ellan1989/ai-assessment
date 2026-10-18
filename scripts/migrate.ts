import { getDb } from "@/lib/db";
import { MIGRATIONS } from "@/lib/db/migrations";

// Runs all pending migrations (also happens automatically on server boot).
const db = getDb();
const applied = (db.prepare("SELECT id, name FROM schema_migrations ORDER BY id").all() as { id: number; name: string }[]);
console.log(`Database at ${process.env.DATABASE_PATH ?? ".data/app.db"} — migrations applied: ${applied.length}/${MIGRATIONS.length}`);
for (const m of applied) console.log(`  ✓ ${m.id} ${m.name}`);
