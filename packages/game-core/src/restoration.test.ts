import { describe, expect, it } from 'vitest';
import { SPECIES_BY_ID } from './catalog.ts';
import {
  applyRestoration,
  getRestorationCost,
  getRestorationSeasonFactor,
  getSeasonalRestorationBudget,
  planRestoration,
  RestorationError
} from './restoration.ts';
import { createSpeciesState, generateSiteState } from './simulation.ts';

function setup(siteId: 'foothill' | 'stream_valley' = 'foothill') {
  const targetId = siteId === 'stream_valley' ? 'acorus-calamus' : 'prunus-davidiana';
  const neighborId = 'rhododendron-simsii';
  const species = SPECIES_BY_ID.get(targetId)!;
  const neighbor = SPECIES_BY_ID.get(neighborId)!;
  const site = generateSiteState('save', 'restoration-seed', 1, 'autumn', 2, siteId);
  const target = createSpeciesState('save', 'restoration-seed', 1, 'autumn', siteId, species.id);
  const other = createSpeciesState('save', 'restoration-seed', 1, 'autumn', siteId, neighbor.id);
  const capacities: Record<string, number> = {
    [species.id]: species.zones[siteId]!.carryingCapacity,
    [neighbor.id]: neighbor.zones[siteId]!.carryingCapacity
  };
  return {
    species,
    site: { ...site, disturbance: 0.2 },
    target,
    other,
    targetCapacity: species.zones[siteId]!.carryingCapacity,
    capacityOf: (state: { speciesId: string }) => capacities[state.speciesId]
  };
}

describe('restoration season resource competition', () => {
  it('charges seasonal resources with season-dependent costs', () => {
    expect(getSeasonalRestorationBudget()).toBe(6);
    expect(getRestorationCost('reduce_disturbance', 'spring')).toBe(1);
    expect(getRestorationCost('protect_seed_bank', 'autumn')).toBeCloseTo(2.6, 5);
    expect(getRestorationCost('restore_wetland', 'summer')).toBeCloseTo(3.9, 5);
  });

  it('rejects an action when the seasonal budget is exhausted', () => {
    const { site, target, targetCapacity } = setup();
    expect(() =>
      planRestoration({
        action: 'establish_plot',
        season: 'spring',
        site,
        target,
        carryingCapacity: targetCapacity,
        budgetSpent: 5,
        alreadyAppliedThisSeason: false
      })
    ).toThrow(RestorationError);
  });

  it('refuses to stack the same action at the same site within a season', () => {
    const { site, target, targetCapacity } = setup();
    expect(() =>
      planRestoration({
        action: 'reduce_disturbance',
        season: 'spring',
        site,
        target,
        carryingCapacity: targetCapacity,
        budgetSpent: 0,
        alreadyAppliedThisSeason: true
      })
    ).toThrow(/重复施工不会叠加收益/);
  });

  it('restricts wetland restoration to the stream valley', () => {
    const { site, target, targetCapacity } = setup('foothill');
    expect(() =>
      planRestoration({
        action: 'restore_wetland',
        season: 'summer',
        site,
        target,
        carryingCapacity: targetCapacity,
        budgetSpent: 0,
        alreadyAppliedThisSeason: false
      })
    ).toThrow(/溪谷湿地/);
  });

  it('applies site-level and target-level effects plus cohabitant spillover', () => {
    const { site, target, other, targetCapacity, capacityOf } = setup();
    const targetBefore = { health: target.health, seedBank: target.seedBank };
    const otherBefore = { health: other.health, seedBank: other.seedBank };
    const impact = planRestoration({
      action: 'reduce_disturbance',
      season: 'autumn',
      site,
      target,
      carryingCapacity: targetCapacity,
      budgetSpent: 0,
      alreadyAppliedThisSeason: false
    });
    const result = applyRestoration(site, [target, other], target.speciesId, impact, capacityOf);

    expect(result.site.disturbance).toBeLessThan(site.disturbance);
    expect(result.states[0]!.health).toBeGreaterThan(targetBefore.health);
    expect(result.states[1]!.health).toBeGreaterThan(otherBefore.health);
    // 目标物种得到的收益高于同区其他物种
    expect(result.states[0]!.health - targetBefore.health).toBeGreaterThan(result.states[1]!.health - otherBefore.health);
  });

  it('makes autumn seed-bank protection stronger but costlier', () => {
    const { site, target, targetCapacity } = setup();
    const autumn = planRestoration({
      action: 'protect_seed_bank',
      season: 'autumn',
      site,
      target,
      carryingCapacity: targetCapacity,
      budgetSpent: 0,
      alreadyAppliedThisSeason: false
    });
    const spring = planRestoration({
      action: 'protect_seed_bank',
      season: 'spring',
      site,
      target,
      carryingCapacity: targetCapacity,
      budgetSpent: 0,
      alreadyAppliedThisSeason: false
    });
    expect(getRestorationSeasonFactor('protect_seed_bank', 'autumn')).toBeGreaterThan(
      getRestorationSeasonFactor('protect_seed_bank', 'spring')
    );
    expect(autumn.cost).toBeGreaterThan(spring.cost);
    expect(autumn.target.seedBankDelta).toBeGreaterThan(spring.target.seedBankDelta);
  });

  it('raises soil moisture for the whole site only when restoring the wetland', () => {
    const { site, target, other, targetCapacity, capacityOf } = setup('stream_valley');
    const impact = planRestoration({
      action: 'restore_wetland',
      season: 'summer',
      site,
      target,
      carryingCapacity: targetCapacity,
      budgetSpent: 0,
      alreadyAppliedThisSeason: false
    });
    const result = applyRestoration(site, [target, other], target.speciesId, impact, capacityOf);
    expect(result.site.soilMoisture).toBeGreaterThan(site.soilMoisture);
    expect(result.site.disturbance).toBeLessThan(site.disturbance);
  });
});
