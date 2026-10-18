// Each vitest process gets its own throwaway SQLite database.
process.env.DATABASE_PATH = `.data/test-${process.pid}.db`;
process.env.APP_SECRET = "test-secret-0123456789";
process.env.ADMIN_EMAIL = "admin@test.local";
process.env.ADMIN_PASSWORD = "test-password-123";
process.env.APP_BASE_URL = "http://localhost:3000";
// No LLM key → deterministic report path in tests.
delete process.env.LLM_API_KEY;
