import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = neon(url);

await sql`ALTER TABLE speedtest_results ADD COLUMN IF NOT EXISTS loaded_latency_ms DOUBLE PRECISION DEFAULT 0`;
await sql`ALTER TABLE speedtest_results ADD COLUMN IF NOT EXISTS unloaded_latency_ms DOUBLE PRECISION DEFAULT 0`;
await sql`ALTER TABLE speedtest_results ADD COLUMN IF NOT EXISTS jitter_ms DOUBLE PRECISION DEFAULT 0`;
await sql`ALTER TABLE speedtest_results ADD COLUMN IF NOT EXISTS score INTEGER DEFAULT 0`;
await sql`ALTER TABLE speedtest_results ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'average'`;
await sql`ALTER TABLE speedtest_results ADD COLUMN IF NOT EXISTS client_ip TEXT DEFAULT ''`;
await sql`ALTER TABLE speedtest_results ADD COLUMN IF NOT EXISTS client_city TEXT DEFAULT ''`;
await sql`ALTER TABLE speedtest_results ADD COLUMN IF NOT EXISTS client_region TEXT DEFAULT ''`;
await sql`ALTER TABLE speedtest_results ADD COLUMN IF NOT EXISTS client_country TEXT DEFAULT ''`;
await sql`ALTER TABLE speedtest_results ADD COLUMN IF NOT EXISTS as_owner TEXT DEFAULT ''`;
await sql`ALTER TABLE speedtest_results ADD COLUMN IF NOT EXISTS edge_id TEXT DEFAULT ''`;

console.log("Migration complete: new columns added");
process.exit(0);
