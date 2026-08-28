import crypto from 'node:crypto';
import db from '../db.js';

const digest = value => crypto.createHash('sha256').update(String(value || '')).digest('hex');

export class RateLimitStore {
  async consume(_keys, _options) { throw new Error('not_implemented'); }
  async clear(_keys) {}
}

export class SqliteRateLimitStore extends RateLimitStore {
  constructor(database = db) {
    super();
    this.db = database;
    this.consumeTransaction = database.transaction((keys, now, windowMs, maxAttempts) => {
      database.prepare('DELETE FROM auth_rate_limits WHERE reset_at <= ?').run(now);
      const select = database.prepare('SELECT attempts,reset_at FROM auth_rate_limits WHERE bucket_key=?');
      const insert = database.prepare(`INSERT INTO auth_rate_limits(bucket_key,attempts,reset_at,updated_at)
        VALUES (?,?,?,?) ON CONFLICT(bucket_key) DO UPDATE SET attempts=excluded.attempts,reset_at=excluded.reset_at,updated_at=excluded.updated_at`);
      const results = [];
      for (const key of keys) {
        const row = select.get(key);
        const attempts = row && row.reset_at > now ? Number(row.attempts) + 1 : 1;
        const resetAt = row && row.reset_at > now ? Number(row.reset_at) : now + windowMs;
        insert.run(key, attempts, resetAt, new Date(now).toISOString());
        results.push({ key, attempts, resetAt, limited: attempts > maxAttempts });
      }
      return results;
    });
  }

  async consume(keys, { now = Date.now(), windowMs, maxAttempts }) {
    return this.consumeTransaction([...new Set(keys)], now, windowMs, maxAttempts);
  }

  async clear(keys) {
    const statement = this.db.prepare('DELETE FROM auth_rate_limits WHERE bucket_key=?');
    this.db.transaction(values => values.forEach(key => statement.run(key)))([...new Set(keys)]);
  }
}

export class RedisRateLimitStore extends RateLimitStore {
  constructor(client, prefix = 'evicare:auth-rate:') { super(); this.client = client; this.prefix = prefix; }

  async consume(keys, { windowMs, maxAttempts }) {
    const results = [];
    for (const key of [...new Set(keys)]) {
      const redisKey = this.prefix + key;
      const count = await this.client.incr(redisKey);
      if (count === 1) await this.client.pExpire(redisKey, windowMs);
      let ttl = await this.client.pTTL(redisKey);
      if (ttl < 0) { await this.client.pExpire(redisKey, windowMs); ttl = windowMs; }
      results.push({ key, attempts: count, resetAt: Date.now() + ttl, limited: count > maxAttempts });
    }
    return results;
  }

  async clear(keys) {
    const values = [...new Set(keys)].map(key => this.prefix + key);
    if (values.length) await this.client.del(values);
  }
}

let singleton;
export async function getRateLimitStore() {
  if (singleton) return singleton;
  const mode = String(process.env.LOGIN_RATE_STORE || (process.env.NODE_ENV === 'production' ? 'redis' : 'sqlite')).toLowerCase();
  if (mode === 'redis') {
    if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required when LOGIN_RATE_STORE=redis');
    const { createClient } = await import('redis');
    const client = createClient({ url: process.env.REDIS_URL });
    client.on('error', error => console.error('[rate-limit] redis_error', error?.code || error?.name || 'unknown'));
    await client.connect();
    singleton = new RedisRateLimitStore(client);
  } else singleton = new SqliteRateLimitStore();
  return singleton;
}

export function loginRateKeys(req, identifier) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const account = String(identifier || '').trim().toLocaleLowerCase('zh-CN') || 'missing';
  return [`ip:${digest(ip)}`, `account:${digest(account)}`];
}
