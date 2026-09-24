import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { GameCommand, Season, WorldSnapshot } from '@shanhai/contracts';
import { createApp } from '../src/app.ts';

describe('ecological restoration upgrades', () => {
  let app: ReturnType<typeof createApp>['app'];
  let store: ReturnType<typeof createApp>['store'];
  let agent: ReturnType<typeof request.agent>;

  beforeAll(() => {
    const created = createApp({ databasePath: ':memory:', loggerEnabled: false });
    app = created.app;
    store = created.store;
    agent = request.agent(app);
  });

  afterAll(() => store.close());

  it('unlocks restoration after a declining year', async () => {
    let world = (await agent.post('/api/save').expect(201)).body as WorldSnapshot;

    world = await command(agent, world, {
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
        note: '修复闭环前置观察'
      }
    });
    world = await command(agent, world, { type: 'TAKE_SAMPLE', speciesId: 'prunus-davidiana', method: 'litter' });

    for (const season of ['spring', 'summer', 'autumn', 'winter'] as Season[]) {
      expect(world.season).toBe(season);
      world = await advanceToDayEight(agent, world);
      world = await command(agent, world, { type: 'END_SEASON' });
      if (season !== 'winter') {
        world = await command(agent, world, { type: 'BEGIN_NEXT_SEASON' });
      }
    }
    expect(world.restorationUnlocked).toBe(true);
    world = await command(agent, world, { type: 'BEGIN_NEXT_YEAR' });
    expect(world.year).toBe(2);
  });

  it('competes for a shared seasonal budget with diminishing efficiency', async () => {
    let world = await currentWorld();
    const foothill = () => world.sites.find((site) => site.id === 'foothill')!;

    expect(foothill().restoration.capacity).toBe(6);
    expect(foothill().restoration.remaining).toBe(6);
    expect(foothill().restoration.nextEfficiency).toBe(1);

    world = await command(agent, world, {
      type: 'RESTORE_HABITAT',
      speciesId: 'prunus-davidiana',
      action: 'reduce_disturbance'
    });
    expect(foothill().restoration.effortUsed).toBe(3);
    expect(foothill().restoration.remaining).toBe(3);
    expect(foothill().restoration.nextEfficiency).toBeLessThan(1);

    world = await command(agent, world, {
      type: 'RESTORE_HABITAT',
      speciesId: 'prunus-davidiana',
      action: 'protect_seed_bank'
    });
    const efficiencies = foothill().restoration.projects.map((project) => project.efficiency);
    expect(efficiencies[0]).toBe(1);
    expect(efficiencies[1]!).toBeLessThan(efficiencies[0]!);
    expect(foothill().restoration.remaining).toBe(1);
  });

  it('rolls back state when the seasonal budget cannot afford a measure', async () => {
    const world = await currentWorld();
    // 已投入 3 + 2 = 5 点；设置样方需 2 点，容量不足。
    const before = await snapshotCounts(world.saveId);
    const response = await agent
      .post(`/api/save/${world.saveId}/commands`)
      .send({
        expectedRevision: world.revision,
        idempotencyKey: 'capacity-failure-0001',
        command: { type: 'RESTORE_HABITAT', speciesId: 'prunus-davidiana', action: 'establish_plot' }
      })
      .expect(409);
    expect(response.body.code).toBe('RESTORATION_CAPACITY_EXHAUSTED');

    const after = await snapshotCounts(world.saveId);
    expect(after).toEqual(before);
    const refreshed = await currentWorld();
    expect(refreshed.revision).toBe(world.revision);
    expect(refreshed.actionPoints).toBe(world.actionPoints);
  });

  it('rejects duplicate regional restoration without stacking benefits', async () => {
    const world = await currentWorld();
    const projectCount = Number(
      (store.db.prepare('SELECT COUNT(*) AS count FROM restoration_projects').get() as unknown as { count: number }).count
    );
    const response = await agent
      .post(`/api/save/${world.saveId}/commands`)
      .send({
        expectedRevision: world.revision,
        idempotencyKey: 'duplicate-restore-0001',
        command: { type: 'RESTORE_HABITAT', speciesId: 'orychophragmus-violaceus', action: 'reduce_disturbance' }
      })
      .expect(409);
    expect(response.body.code).toBe('RESTORATION_ALREADY_PLANNED');
    expect(
      Number((store.db.prepare('SELECT COUNT(*) AS count FROM restoration_projects').get() as unknown as { count: number }).count)
    ).toBe(projectCount);
  });

  it('settles regional co-benefits onto co-occurring species at season close', async () => {
    let world = await currentWorld();
    const disturbanceBefore = world.sites.find((site) => site.id === 'foothill')!.environment.disturbance;
    expect(disturbanceBefore).toBeLessThan(0.08 + 1e-9);
    const foothillProjects = world.sites.find((site) => site.id === 'foothill')!.restoration.projects.length;

    world = await advanceToDayEight(agent, world);
    world = await command(agent, world, { type: 'END_SEASON' });
    expect(world.seasonReview!.changes.some((line) => line.includes('增长趋势'))).toBe(true);
    expect(world.sites.find((site) => site.id === 'foothill')!.restoration.projects.length).toBe(foothillProjects);
    world = await command(agent, world, { type: 'BEGIN_NEXT_SEASON' });
  });

  it('serializes concurrent identical restorations so only one bonus lands', async () => {
    let world = await currentWorld();
    world = await command(agent, world, { type: 'MOVE_ZONE', siteId: 'stream_valley' });

    const body = (suffix: string) => ({
      expectedRevision: world.revision,
      idempotencyKey: `concurrent-restore-${suffix}`,
      command: { type: 'RESTORE_HABITAT' as const, speciesId: 'acorus-calamus', action: 'restore_wetland' as const }
    });

    const responses = await Promise.all([
      agent.post(`/api/save/${world.saveId}/commands`).send(body('a')),
      agent.post(`/api/save/${world.saveId}/commands`).send(body('b'))
    ]);
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 409]);
    const rejected = responses.find((response) => response.status === 409)!;
    expect(['RESTORATION_ALREADY_PLANNED', 'REVISION_CONFLICT']).toContain(rejected.body.code);

    const projects = store.db
      .prepare(
        `SELECT COUNT(*) AS count FROM restoration_projects
         WHERE save_id = ? AND year = ? AND season = ? AND site_id = 'stream_valley' AND action = 'restore_wetland'`
      )
      .get(world.saveId, world.year, world.season) as unknown as { count: number };
    expect(Number(projects.count)).toBe(1);

    // 取成功响应后的世界状态供后续测试使用。
    const success = responses.find((response) => response.status === 200)!;
    expect(success.body.event.effects.some((line: string) => line.includes('季节竞争效率'))).toBe(true);
  });

  it('replays the full command history into a matching deterministic state', async () => {
    let world = await currentWorld();
    world = await command(agent, world, { type: 'WAIT' });
    world = await advanceToDayEight(agent, world);
    world = await command(agent, world, { type: 'END_SEASON' });
    world = await command(agent, world, { type: 'BEGIN_NEXT_SEASON' });
    world = await command(agent, world, { type: 'WAIT' });

    const history = await agent.get(`/api/save/${world.saveId}/history`).expect(200);
    expect(history.body.commands.length).toBeGreaterThan(40);
    expect(history.body.commands.at(-1).command.type).toBe('WAIT');
    expect(history.body.commands.some((entry: { command: GameCommand }) => entry.command.type === 'RESTORE_HABITAT')).toBe(true);

    const replay = await agent.post(`/api/save/${world.saveId}/replay`).expect(200);
    expect(replay.body.match).toBe(true);
    expect(replay.body.commandsReplayed).toBe(history.body.commands.length);
    expect(replay.body.revisionMatch).toBe(true);
    expect(replay.body.yearMatch).toBe(true);
    expect(replay.body.seasonMatch).toBe(true);
    expect(replay.body.stateMatch).toBe(true);
    expect(replay.body.firstDifference).toBeNull();
  });

  async function currentWorld(): Promise<WorldSnapshot> {
    const current = await agent.get('/api/save/current').expect(200);
    expect(current.body.world).toBeTruthy();
    return current.body.world as WorldSnapshot;
  }

  async function snapshotCounts(saveId: string) {
    const count = (sql: string) =>
      Number((store.db.prepare(sql).get(saveId) as unknown as { count: number }).count);
    const projects = store.db
      .prepare('SELECT * FROM restoration_projects WHERE save_id = ? ORDER BY sequence')
      .all(saveId) as unknown as Array<Record<string, unknown>>;
    return {
      events: count('SELECT COUNT(*) AS count FROM game_events WHERE save_id = ?'),
      logs: count('SELECT COUNT(*) AS count FROM command_log WHERE save_id = ?'),
      receipts: count('SELECT COUNT(*) AS count FROM command_receipts WHERE save_id = ?'),
      projects: JSON.stringify(projects)
    };
  }
});

async function command(
  agentRequest: ReturnType<typeof request.agent>,
  world: WorldSnapshot,
  commandBody: GameCommand
): Promise<WorldSnapshot> {
  const response = await agentRequest
    .post(`/api/save/${world.saveId}/commands`)
    .send({
      expectedRevision: world.revision,
      idempotencyKey: `restore-test-${world.revision}-${commandBody.type}-${Math.random().toString(16).slice(2)}`,
      command: commandBody
    });
  if (response.status !== 200) {
    throw new Error(
      `${commandBody.type} failed at year ${world.year} ${world.season} day ${world.day}: ${response.status} ${JSON.stringify(response.body)}`
    );
  }
  return response.body.world as WorldSnapshot;
}

async function advanceToDayEight(
  agentRequest: ReturnType<typeof request.agent>,
  initialWorld: WorldSnapshot
): Promise<WorldSnapshot> {
  let world = initialWorld;
  let guard = 0;
  while (world.day < 8) {
    world = await command(agentRequest, world, { type: 'WAIT' });
    guard += 1;
    if (guard > 40) {
      throw new Error('Unable to advance to day 8');
    }
  }
  return world;
}
