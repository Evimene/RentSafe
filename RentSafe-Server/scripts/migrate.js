import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../src/db.js';

const dir = path.resolve('migrations');
const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

for (const f of files) {
  const sql = await fs.readFile(path.join(dir, f), 'utf8');
  console.log('->', f);
  await pool.query(sql);
}

console.log('migrations complete');
await pool.end();