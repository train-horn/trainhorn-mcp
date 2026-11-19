// Protocol smoke test: spawn the server and talk MCP over stdio (initialize, tools/list, tools/call, resources).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../server/index.js', import.meta.url));

function session() {
  const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const waiting = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      const w = waiting.get(msg.id);
      if (w) {
        waiting.delete(msg.id);
        w(msg);
      }
    }
  });
  let next = 1;
  const send = (obj) => child.stdin.write(`${JSON.stringify(obj)}\n`);
  return {
    request(method, params) {
      const id = next++;
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 5000);
        waiting.set(id, (m) => {
          clearTimeout(t);
          resolve(m);
        });
        send({ jsonrpc: '2.0', id, method, params });
      });
    },
    notify(method, params) {
      send({ jsonrpc: '2.0', method, params });
    },
    raw(line, id) {
      return new Promise((resolve) => {
        waiting.set(id, resolve);
        child.stdin.write(`${line}\n`);
      });
    },
    close() {
      child.stdin.end();
      return new Promise((resolve) => child.on('exit', (code) => resolve(code)));
    },
  };
}

test('MCP over stdio: initialize, tools/list, tools/call, resources', async () => {
  const s = session();
  const init = await s.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'smoke-test', version: '0' },
  });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'trainhorn-mcp');
  assert.ok(init.result.capabilities.tools);
  s.notify('notifications/initialized');

  const list = await s.request('tools/list', {});
  const names = list.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['air_tank_runtime', 'compressor_recovery', 'distance_for_level', 'spl_at_distance', 'wire_gauge']);
  for (const t of list.result.tools) {
    assert.equal(t.inputSchema.type, 'object');
    assert.equal(t.annotations.readOnlyHint, true);
  }

  const call = await s.request('tools/call', { name: 'spl_at_distance', arguments: { source_db: 150, distance: 100 } });
  assert.equal(call.result.isError, false);
  assert.equal(call.result.structuredContent.level_db, 130.0);
  assert.match(call.result.content[0].text, /130 dB at 100 ft/);

  const badArgs = await s.request('tools/call', { name: 'air_tank_runtime', arguments: { tank_gallons: -1 } });
  assert.equal(badArgs.result.isError, true);

  const unknown = await s.request('tools/call', { name: 'nope', arguments: {} });
  assert.equal(unknown.error.code, -32602);

  const res = await s.request('resources/list', {});
  assert.equal(res.result.resources[0].uri, 'trainhorn://notes/horn-law-basics');
  const read = await s.request('resources/read', { uri: 'trainhorn://notes/horn-law-basics' });
  assert.match(read.result.contents[0].text, /not legal advice/);

  assert.equal((await s.request('ping')).result && true, true);
  assert.equal((await s.request('no/such/method', {})).error.code, -32601);
  const parse = await s.raw('{not json', null);
  assert.equal(parse.error.code, -32700);

  assert.equal(await s.close(), 0);
});

test('unknown protocol version falls back to the latest supported', async () => {
  const s = session();
  const init = await s.request('initialize', { protocolVersion: '1999-01-01', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  assert.equal(init.result.protocolVersion, '2025-11-25');
  await s.close();
});
