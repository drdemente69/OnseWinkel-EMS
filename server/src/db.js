import Database from 'better-sqlite3';
import config from './config.js';

const db = new Database(config.dbPath);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

export default db;

export function tx(fn) {
  const wrapped = db.transaction(fn);
  return wrapped();
}
