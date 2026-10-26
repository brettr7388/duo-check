// Minimal in-memory KV with TTL, same surface the Worker uses (get, put, get with 'arrayBuffer').
export class FakeKV {
  constructor() { this.m = new Map(); this.now = () => Date.now(); }
  async get(k, type) {
    const e = this.m.get(k);
    if (!e) return null;
    if (e.exp && e.exp <= this.now()) { this.m.delete(k); return null; }
    if (type === 'arrayBuffer') return e.v instanceof ArrayBuffer ? e.v : new TextEncoder().encode(String(e.v)).buffer;
    return typeof e.v === 'string' ? e.v : e.v;
  }
  async put(k, v, opts = {}) {
    if (opts.expirationTtl !== undefined && opts.expirationTtl < 60) throw new Error('KV minimum expirationTtl is 60');
    this.m.set(k, { v, exp: opts.expirationTtl ? this.now() + opts.expirationTtl * 1000 : 0 });
  }
}
