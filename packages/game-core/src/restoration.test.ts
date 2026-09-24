import { describe, expect, it } from 'vitest';
import { SPECIES_BY_ID } from './catalog.ts';
import {
  applyRestorationImmediate,
  applySiteRestoration,
  createSpeciesState,
  generateSiteState,
  planRestoration,
  projectSettlementEffects,
  restorationEfficiency,
  restorationRemaining,
  RESTORATION_BLUEPRINTS,
  RESTORATION_SEASON_CAPACITY,
  RESTORATION_SITE_SCOPED,
  settleRestorationSeason,
  type RestorationProject
} from './index.ts';

function project(overrides: Partial<RestorationProject> = {}): RestorationProject {
  return {
    saveId: 'save',
    year: 1,
    season: 'summer',
    siteId: 'foothill',
    sequence: 1,
    action: 'reduce_disturbance',
    scopeSpeciesId: '*',
    targetSpeciesId: 'prunus-davidiana',
    effort: 3,
    efficiency: 0.9,
    day: 4,
    ...overrides

  };
}

describe('restoration season capacity and competition', () => {
  it('shrinks efficiency as more of the seasonal budget is committed', () => {
    expect(restorationEfficiency(0)).toBe(1);
    const first = restorationEfficiency(0);
    const second = restorationEfficiency(RESTORATION_BLUEPRINTS.reduce_disturbance.effort);
    expect(second).toBeLessThan(first);
    // 容量完全占满时也保留最低效率，不会归零。
    expect(restorationEfficiency(RESTORATION_SEASON_CAPACITY)).toBeGreaterThanOrEqual(0.55);
  });

  it('tracks remaining capacity from committed projects', () => {
    const projects = [project({ effort: 3 }), project({ sequence: 2, action: 'establish_plot', effort: 2, targetSpeciesId: 'orychophragmus-violaceus' })];
    expect(restorationRemaining(projects)).toBe(1);
  });

  it('flags site-scoped measures that share the regional uniqueness slot', () => {
    expect(RESTORATION_SITE_SCOPED.has('reduce_disturbance')).toBe(true);
    expect(RESTORATION_SITE_SCOPED.has('restore_wetland')).toBe(true);
    expect(RESTORATION_SITE_SCOPED.has('protect_seed_bank')).toBe(false);
    expect(RESTORATION_SITE_SCOPED.has('establish_plot')).toBe(false);
  });
});

describe('restoration immediate effects', () => {
  it('lowers disturbance for regional measures and improves the target species', () => {
    const site = { ...generateSiteState('save', 'seed-r', 1, 'summer', 4, 'foothill'), disturbance: 0.3 };
    const species = SPECIES_BY_ID.get('prunus-davidiana')!;
    const state = { ...createSpeciesState('save', 'seed-r', 1, 'summer', 'foothill', species.id), health: 60, seedBank: 20 };
    const effects = planRestoration('reduce_disturbance', species.zones.foothill!.carryingCapacity, 0);

    const nextSite = applySiteRestoration(site, effects);
    expect(nextSite.disturbance).toBeLessThan(site.disturbance);
    const nextState = applyRestorationImmediate(state, effects, species.zones.foothill!.carryingCapacity);
    expect(nextState.health).toBeGreaterThan(state.health);
    // 降低干扰不直接补种子库。
    expect(nextState.seedBank).toBe(state.seedBank);
    // 区域性措施当季为目标物种补充极少量可繁殖个体。
    expect(nextState.population).toBeGreaterThan(state.population);
  });

  it('keeps seed-bank protection focused on the target species seed bank', () => {
    const species = SPECIES_BY_ID.get('prunus-davidiana')!;
    const state = { ...createSpeciesState('save', 'seed-r2', 1, 'summer', 'foothill', species.id), seedBank: 10 };
    const effects = planRestoration('protect_seed_bank', species.zones.foothill!.carryingCapacity, 0);
    const nextState = applyRestorationImmediate(state, effects, species.zones.foothill!.carryingCapacity);
    expect(nextState.seedBank).toBeGreaterThan(state.seedBank);
    expect(effects.disturbanceDelta).toBe(0);
    expect(effects.recruitmentDelta).toBe(0);
  });

  it('clamps every bounded value', () => {
    const species = SPECIES_BY_ID.get('prunus-davidiana')!;
    const capacity = species.zones.foothill!.carryingCapacity;
    const state = {
      ...createSpeciesState('save', 'seed-r3', 1, 'summer', 'foothill', species.id),
      health: 100,
      seedBank: capacity * 1.8,
      population: capacity * 1.2
    };
    const effects = planRestoration('restore_wetland', capacity, 0);
    const nextState = applyRestorationImmediate(state, effects, capacity);
    expect(nextState.health).toBeLessThanOrEqual(100);
    expect(nextState.seedBank).toBeLessThanOrEqual(capacity * 1.8);
    expect(nextState.population).toBeLessThanOrEqual(capacity * 1.2);
  });
});

describe('restoration season settlement', () => {
  it('lets regional measures benefit co-occurring species at season close', () => {
    const speciesA = SPECIES_BY_ID.get('prunus-davidiana')!;
    const speciesB = SPECIES_BY_ID.get('orychophragmus-violaceus')!;
    const stateA = { ...createSpeciesState('save', 'seed-r4', 1, 'summer', 'foothill', speciesA.id), health: 50 };
    const stateB = { ...createSpeciesState('save', 'seed-r4', 1, 'summer', 'foothill', speciesB.id), health: 50 };

    const settled = settleRestorationSeason(
      [project({ targetSpeciesId: speciesA.id, action: 'reduce_disturbance' })],
      [stateA, stateB],
      (siteId, speciesId) => SPECIES_BY_ID.get(speciesId)?.zones[siteId]?.carryingCapacity
    );
    const nextB = settled.find((entry) => entry.speciesId === speciesB.id)!;
    expect(nextB.health).toBeGreaterThan(stateB.health);
  });

  it('does not let seed-bank protection spill over to other species', () => {
    const speciesA = SPECIES_BY_ID.get('prunus-davidiana')!;
    const speciesB = SPECIES_BY_ID.get('orychophragmus-violaceus')!;
    const stateA = createSpeciesState('save', 'seed-r5', 1, 'summer', 'foothill', speciesA.id);
    const stateB = { ...createSpeciesState('save', 'seed-r5', 1, 'summer', 'foothill', speciesB.id), seedBank: 30, health: 50 };

    const settled = settleRestorationSeason(
      [project({ action: 'protect_seed_bank', scopeSpeciesId: speciesA.id, targetSpeciesId: speciesA.id })],
      [stateA, stateB],
      (siteId, speciesId) => SPECIES_BY_ID.get(speciesId)?.zones[siteId]?.carryingCapacity
    );
    const nextB = settled.find((entry) => entry.speciesId === speciesB.id)!;
    expect(nextB.seedBank).toBe(stateB.seedBank);
    expect(nextB.health).toBe(stateB.health);
  });

  it('returns deterministic settlement effects for the target and bystanders', () => {
    const species = SPECIES_BY_ID.get('prunus-davidiana')!;
    const state = createSpeciesState('save', 'seed-r6', 1, 'summer', 'foothill', species.id);
    const target = projectSettlementEffects(project(), state, species.zones.foothill!.carryingCapacity);
    const bystanderState = { ...state, speciesId: 'orychophragmus-violaceus' };
    const bystanderCapacity = SPECIES_BY_ID.get('orychophragmus-violaceus')!.zones.foothill!.carryingCapacity;
    const bystander = projectSettlementEffects(project(), bystanderState, bystanderCapacity);
    expect(target.healthDelta).toBeGreaterThan(0);
    expect(bystander.healthDelta).toBeGreaterThan(target.healthDelta);
    expect(bystander.recruitmentDelta).toBeGreaterThan(0);
  });
});
