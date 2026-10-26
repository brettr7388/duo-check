// Writes the JS body for the Cloudflare MCP `execute` tool (or a plain script you can adapt to the REST API):
// bundles with wrangler's dry run and uploads the Worker, with its Browser + KV bindings, then enables workers.dev.
//   KV_ID=<kv namespace id> node deploy/make-mcp-deploy.mjs <out.js> [--name duo-check]
// Run from the repo root. No secrets are involved: the Browser binding and the KV id are account resources.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const out = args[0];
const nameIdx = args.indexOf('--name');
const NAME = nameIdx > 0 ? args[nameIdx + 1] : 'duo-check';
const kvId = process.env.KV_ID;
const toml = readFileSync('wrangler.toml', 'utf8');
const date = /compatibility_date\s*=\s*"([^"]+)"/.exec(toml)[1];
const vars = {};
for (const m of toml.matchAll(/^([A-Z_]+)\s*=\s*"([^"]*)"/gm)) vars[m[1]] = m[2];

rmSync('dist', { recursive: true, force: true });
execFileSync('npx', ['wrangler', 'deploy', '--dry-run', '--outdir', 'dist'], { stdio: 'ignore' });
const files = readdirSync('dist').filter((f) => !f.endsWith('.map') && f !== 'README.md');
const type = (f) => (f === 'worker.js' ? 'application/javascript+module' : f.endsWith('.woff2') ? 'application/octet-stream' : 'text/plain');
const modules = files.map((f) => ({ name: f, type: type(f), b64: readFileSync(join('dist', f)).toString('base64') }));
const bindings = [
  { type: 'browser', name: 'BROWSER' },
  ...(kvId ? [{ type: 'kv_namespace', name: 'KV', namespace_id: kvId }] : []),
  ...Object.entries(vars).map(([k, v]) => ({ type: 'plain_text', name: k, text: v })),
];
const flags = /compatibility_flags\s*=\s*\[([^\]]*)\]/.exec(toml)?.[1].match(/"([^"]+)"/g)?.map((s) => s.slice(1, -1)) ?? [];

const code = `async () => {
  const NAME = ${JSON.stringify(NAME)};
  const modules = ${JSON.stringify(modules)};
  const acct = \`/accounts/\${accountId}\`;
  const metadata = { main_module: 'worker.js', compatibility_date: ${JSON.stringify(date)}, compatibility_flags: ${JSON.stringify(flags)}, bindings: ${JSON.stringify(bindings)}, observability: { enabled: true, head_sampling_rate: 1 } };
  const B = 'dc' + crypto.randomUUID().replace(/-/g, '');
  const enc = new TextEncoder();
  const parts = [enc.encode(\`--\${B}\\r\\nContent-Disposition: form-data; name="metadata"\\r\\nContent-Type: application/json\\r\\n\\r\\n\${JSON.stringify(metadata)}\\r\\n\`)];
  for (const m of modules) {
    const bin = atob(m.b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    parts.push(enc.encode(\`--\${B}\\r\\nContent-Disposition: form-data; name="\${m.name}"; filename="\${m.name}"\\r\\nContent-Type: \${m.type}\\r\\n\\r\\n\`), u8, enc.encode('\\r\\n'));
  }
  parts.push(enc.encode(\`--\${B}--\\r\\n\`));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const body = new Uint8Array(total);
  let o = 0; for (const p of parts) { body.set(p, o); o += p.length; }
  const put = await cloudflare.request({ method: 'PUT', path: \`\${acct}/workers/scripts/\${NAME}\`, body, contentType: \`multipart/form-data; boundary=\${B}\`, rawBody: true });
  const sub = await cloudflare.request({ method: 'POST', path: \`\${acct}/workers/scripts/\${NAME}/subdomain\`, body: { enabled: true, previews_enabled: false } });
  const zone = (await cloudflare.request({ method: 'GET', path: \`\${acct}/workers/subdomain\` })).result;
  return { ok: put.success, etag: put.result?.etag, modules: modules.length, bytes: total, subdomain: zone?.subdomain, sub: sub.success, bindings: put.result?.bindings?.map((b) => b.name + ':' + b.type) };
}`;
writeFileSync(out, code);
console.log(`wrote ${out}: ${code.length} chars, ${modules.length} modules, name ${NAME}`);
