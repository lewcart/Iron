import { Pool } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf-8');
for (const l of env.split('\n')){const m=l.match(/^([A-Z_]+)="?([^"]*)"?$/);if(m)process.env[m[1]]??=m[2];}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const r = await pool.query(`SELECT movement_pattern, count(*)::int n FROM exercises WHERE movement_pattern IS NOT NULL GROUP BY movement_pattern ORDER BY n DESC`);
for (const row of r.rows) console.log(`${row.n}\t${row.movement_pattern}`);
await pool.end();
