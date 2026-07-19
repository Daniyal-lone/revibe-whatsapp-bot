import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schema = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');

await pool.query(schema);
await pool.end();
console.log('Database schema is ready.');
