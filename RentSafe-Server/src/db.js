import pg from 'pg';
import { config } from './config.js';

// export const pool = new pg.Pool({
//   connectionString: config.db.url,
//   max: 10,
//   idleTimeoutMillis: 30_000,
// });

export const pool = new pg.Pool({
  ...(config.db.url ? { connectionString: config.db.url } : {}),
  user: config.db.user,          
  host: config.db.host,       
  database: config.db.name,   
  password: config.db.password, 
  port: config.db.port,  
  max: 10,
  idleTimeoutMillis: 30_000,              
});


export const query = (text, params) => pool.query(text, params);

export async function withTransaction(fn) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}