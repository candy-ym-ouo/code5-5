import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

const root = path.resolve(import.meta.dirname, '..');
const runtime = await mkdtemp(path.join(tmpdir(), 'shanhai-e2e-'));
const databasePath = path.join(runtime, 'e2e.db');
const port = await getAvailablePort();
const baseUrl = `http://127.0.0.1:${port}`;

const child = spawn(process.execPath, [path.join(root, 'apps/server/dist/index.js')], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(port),
    DATABASE_URL: databasePath,
    APP_ORIGIN: 'http://127.0.0.1:5173',
    LOG_LEVEL: 'error'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let serverOutput = '';
child.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
child.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

try {
  await waitForServer();
  let cookie = '';
  let world = await api('/api/save', { method: 'POST' }, true);

  const send = async (command) => {
    const response = await api(`/api/save/${world.saveId}/commands`, {
      method: 'POST',
      body: JSON.stringify({
        expectedRevision: world.revision,
        idempotencyKey: crypto.randomUUID(),
        command
      })
    });
    world = response.world;
  };

  await send({
    type: 'OBSERVE_PLANT',
    speciesId: 'prunus-davidiana',
    values: {
      phenology: 'leafing',
      leafTexture: 'smooth',
      dominantColor: '#557a45',
      temperatureC: 16,
      humidity: 60,
      soilMoisture: 50,
      lightLux: 30000,
      note: '端到端闭环观察'
    }
  });
  await send({ type: 'TAKE_SAMPLE', speciesId: 'prunus-davidiana', method: 'litter' });

  for (const expectedSeason of ['spring', 'summer', 'autumn', 'winter']) {
    assert.equal(world.season, expectedSeason);
    while (world.day < 8) {
      await send({ type: 'WAIT' });
    }
    await send({ type: 'END_SEASON' });
    if (expectedSeason !== 'winter') {
      await send({ type: 'BEGIN_NEXT_SEASON' });
    }
  }

  assert.equal(world.phase, 'year_review');
  assert.equal(world.annualReview.year, 1);
  assert.ok(world.annualReview.incorrectSamples > 0);
  await send({ type: 'BEGIN_NEXT_YEAR' });
  assert.equal(world.year, 2);
  assert.equal(world.season, 'spring');
  assert.equal(world.phase, 'active');

  // 生态修复：季节资源竞争、区域+物种效果与不可重复加成。
  const foothill = () => world.sites.find((site) => site.id === 'foothill');
  assert.equal(foothill().restoration.capacity, 6);
  assert.equal(foothill().restoration.remaining, 6);

  await send({ type: 'RESTORE_HABITAT', speciesId: 'prunus-davidiana', action: 'reduce_disturbance' });
  assert.equal(foothill().restoration.effortUsed, 3);
  assert.equal(foothill().restoration.remaining, 3);
  assert.ok(foothill().restoration.nextEfficiency < 1, '后续措施应面对更低的竞争效率');
  const firstEfficiency = foothill().restoration.projects[0].efficiency;
  assert.equal(firstEfficiency, 1);

  await send({ type: 'RESTORE_HABITAT', speciesId: 'prunus-davidiana', action: 'protect_seed_bank' });
  const secondEfficiency = foothill().restoration.projects[1].efficiency;
  assert.ok(secondEfficiency < firstEfficiency, '争夺同一季节资源导致边际效率下降');

  // 重复的区域性措施不得叠加收益。
  const duplicateKey = crypto.randomUUID();
  {
    const response = await fetch(`${baseUrl}/api/save/${world.saveId}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        expectedRevision: world.revision,
        idempotencyKey: duplicateKey,
        command: { type: 'RESTORE_HABITAT', speciesId: 'orychophragmus-violaceus', action: 'reduce_disturbance' }
      })
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, 'RESTORATION_ALREADY_PLANNED');
  }

  // 容量不足时整体回滚：已投入 5 点，湿生带需 4 点（且不在溪谷），样方需 2 点同样超额。
  {
    const response = await fetch(`${baseUrl}/api/save/${world.saveId}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        expectedRevision: world.revision,
        idempotencyKey: crypto.randomUUID(),
        command: { type: 'RESTORE_HABITAT', speciesId: 'prunus-davidiana', action: 'establish_plot' }
      })
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, 'RESTORATION_CAPACITY_EXHAUSTED');
  }

  // 历史命令可重放，重放结果与当前权威状态逐表一致。
  {
    const history = await api(`/api/save/${world.saveId}/history`);
    assert.ok(history.commands.length > 40);
    assert.ok(history.commands.some((entry) => entry.command.type === 'RESTORE_HABITAT'));
    const replay = await api(`/api/save/${world.saveId}/replay`, { method: 'POST' });
    assert.equal(replay.commandsReplayed, history.commands.length);
    assert.equal(replay.match, true, JSON.stringify(replay.firstDifference));
    assert.equal(replay.stateMatch, true);
    assert.equal(replay.firstDifference, null);
  }

  const report = await api(`/api/save/${world.saveId}/report/1`);
  assert.equal(report.year, 1);
  console.log('Closed-loop E2E passed: create -> observe -> wrong sample -> four seasons -> report -> year 2 -> restoration competition/dedup -> replay');

  async function waitForServer() {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`Server exited early.\n${serverOutput}`);
      }
      try {
        const response = await fetch(`${baseUrl}/api/health`);
        if (response.ok) return;
      } catch {
        // Retry until the process starts listening.
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    throw new Error(`Server did not start in time.\n${serverOutput}`);
  }

  async function api(url, init = {}, captureCookie = false) {
    const response = await fetch(`${baseUrl}${url}`, {
      ...init,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...init.headers
      }
    });
    if (captureCookie) {
      const setCookie = response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie');
      assert.ok(setCookie, 'save creation did not return a session cookie');
      cookie = setCookie.split(';')[0];
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`${init.method ?? 'GET'} ${url} failed: ${response.status} ${JSON.stringify(body)}`);
    }
    return body;
  }
} finally {
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([
      once(child, 'exit'),
      new Promise((resolve) => setTimeout(resolve, 5_000))
    ]);
  }
  await rm(runtime, { recursive: true, force: true });
}

async function getAvailablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 8799;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}
