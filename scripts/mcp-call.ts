// Invoke a Rebirth MCP tool from the CLI, in-process against the Neon DB in
// .env.local. Same code path as /api/mcp — this just skips the HTTP hop (the
// production deployment sits behind Vercel deployment protection).
//
//   npx tsx scripts/mcp-call.ts <tool_name> '<json args>'
//   npx tsx scripts/mcp-call.ts --list
import { readFileSync } from 'fs';

const env = readFileSync('.env.local', 'utf-8');
for (const l of env.split('\n')) {
  const m = l.match(/^([A-Z_]+)="?([^"]*)"?$/);
  if (m) process.env[m[1]] ??= m[2];
}

const { tools, executeTool } = await import('../src/lib/mcp-tools');

const [name, argJson] = process.argv.slice(2);

if (name === '--list') {
  console.log(tools.map((t) => t.name).sort().join('\n'));
} else if (name === '--schema') {
  const t = tools.find((x) => x.name === argJson);
  console.log(JSON.stringify(t?.inputSchema ?? `no tool named ${argJson}`, null, 2));
} else {
  // `@path` reads the args JSON from a file — avoids shell quoting on big payloads.
  const raw = argJson?.startsWith('@') ? readFileSync(argJson.slice(1), 'utf-8') : argJson;
  const result = await executeTool(name, raw ? JSON.parse(raw) : {});
  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
}
process.exit(0);
