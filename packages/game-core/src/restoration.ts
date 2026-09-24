import type { RestorationAction, Season } from '@shanhai/contracts';
import { SEASONAL_RESTORATION_BUDGET } from '@shanhai/contracts';
import { clamp, getStatus, round } from './simulation.ts';
import type { SiteState, SpeciesState } from './types.ts';

/**
 * 生态修复引擎。
 *
 * 同一季节内所有修复措施共享一个有限的资源预算（工时/物资），
 * 措施成本随季节适宜度浮动，玩家必须在“降低干扰 / 保护种子库 /
 * 恢复湿生带 / 设置样方”之间竞争分配，而不是无成本地逐项刷满。
 */

export const RESTORATION_ACTION_LABELS: Record<RestorationAction, string> = {
  reduce_disturbance: '降低区域干扰',
  protect_seed_bank: '保留种子区',
  restore_wetland: '恢复湿生带',
  establish_plot: '设置长期观察样方'
};

export const RESTORATION_ACTION_DESCRIPTIONS: Record<RestorationAction, string> = {
  reduce_disturbance: '巡护封控踩踏与采集，降低区域干扰并惠及目标物种健康。',
  protect_seed_bank: '围封落种区域，大幅补充目标物种种子库，同区物种获得少量庇护。',
  restore_wetland: '疏通水文恢复湿生带，仅可在溪谷湿地执行，降低干扰并抬升土壤含水。',
  establish_plot: '布设固定样方长期监测，小幅改善健康、种子库与区域干扰。'
};

/** 措施的基础资源成本（从每季共享预算中扣除）。 */
const BASE_COST: Record<RestorationAction, number> = {
  reduce_disturbance: 1,
  protect_seed_bank: 2,
  restore_wetland: 3,
  establish_plot: 2
};

/** 措施的行动点成本（沿用既有玩法：每次修复 2 AP）。 */
export const RESTORATION_ACTION_POINTS = 2;

/**
 * 季节适宜系数：同一系数同时放大资源成本与修复收益。
 * 在“黄金季节”做修复效果好但占用更多季节资源，形成取舍。
 */
const SEASON_FACTORS: Record<RestorationAction, Record<Season, number>> = {
  reduce_disturbance: { spring: 1, summer: 1, autumn: 1, winter: 1 },
  protect_seed_bank: { spring: 0.7, summer: 0.9, autumn: 1.3, winter: 1 },
  restore_wetland: { spring: 1.1, summer: 1.3, autumn: 0.9, winter: 0.7 },
  establish_plot: { spring: 1.2, summer: 1, autumn: 0.9, winter: 0.8 }
};

export function getRestorationSeasonFactor(action: RestorationAction, season: Season): number {
  return SEASON_FACTORS[action][season];
}

export function getRestorationCost(action: RestorationAction, season: Season): number {
  return round(BASE_COST[action] * SEASON_FACTORS[action][season], 1);
}

export function getSeasonalRestorationBudget(): number {
  return SEASONAL_RESTORATION_BUDGET;
}

export interface RestorationImpact {
  action: RestorationAction;
  cost: number;
  seasonFactor: number;
  site: {
    disturbanceDelta: number;
    soilMoistureDelta: number;
  };
  target: {
    healthDelta: number;
    seedBankDelta: number;
  };
  /** 同区域其他物种获得的溢出收益（庇护效应）。 */
  cohabitants: {
    healthDelta: number;
    seedBankDelta: number;
  };
  messages: string[];
}

export interface RestorationPlanInput {
  action: RestorationAction;
  season: Season;
  site: SiteState;
  target: SpeciesState;
  carryingCapacity: number;
  budgetSpent: number;
  /** 同一季节该区域是否已执行过相同措施。 */
  alreadyAppliedThisSeason: boolean;
}

export class RestorationError extends Error {}

/**
 * 纯函数：评估一次修复的资源占用与预期效果，不修改任何状态。
 * 所有前置校验（区域、预算、不可重复加成）在此完成，失败时抛出
 * RestorationError，调用方在事务内触发整体回滚。
 */
export function planRestoration(input: RestorationPlanInput): RestorationImpact {
  const { action, season, site, target, carryingCapacity, budgetSpent, alreadyAppliedThisSeason } = input;

  if (action === 'restore_wetland' && site.siteId !== 'stream_valley') {
    throw new RestorationError('恢复湿生带只能在溪谷湿地执行');
  }
  if (alreadyAppliedThisSeason) {
    throw new RestorationError('同一区域本季已经执行过该修复，重复施工不会叠加收益');
  }

  const seasonFactor = SEASON_FACTORS[action][season];
  const cost = round(BASE_COST[action] * seasonFactor, 1);
  const remaining = round(SEASONAL_RESTORATION_BUDGET - budgetSpent, 1);
  if (cost > remaining + 1e-9) {
    throw new RestorationError(
      `本季修复资源不足：该措施需要 ${cost}，剩余 ${remaining}（每季总额 ${SEASONAL_RESTORATION_BUDGET}）`
    );
  }

  const impact: RestorationImpact = {
    action,
    cost,
    seasonFactor,
    site: { disturbanceDelta: 0, soilMoistureDelta: 0 },
    target: { healthDelta: 0, seedBankDelta: 0 },
    cohabitants: { healthDelta: 0, seedBankDelta: 0 },
    messages: []
  };

  if (action === 'reduce_disturbance') {
    impact.site.disturbanceDelta = -round(0.07 * seasonFactor, 4);
    impact.target.healthDelta = round(3 * seasonFactor, 1);
    impact.cohabitants.healthDelta = round(1.2 * seasonFactor, 1);
    impact.messages.push('区域干扰下降，巡护同时改善了同区物种的生存压力。');
  }

  if (action === 'protect_seed_bank') {
    impact.target.seedBankDelta = round(carryingCapacity * 0.1 * seasonFactor, 2);
    impact.cohabitants.seedBankDelta = round(carryingCapacity * 0.02 * seasonFactor, 2);
    impact.messages.push('落种区被围封，目标种子库显著补充，同区物种获得少量庇护。');
  }

  if (action === 'restore_wetland') {
    impact.site.disturbanceDelta = -round(0.1 * seasonFactor, 4);
    impact.site.soilMoistureDelta = round(8 * seasonFactor, 1);
    impact.target.healthDelta = round(2.5 * seasonFactor, 1);
    impact.cohabitants.healthDelta = round(1 * seasonFactor, 1);
    impact.messages.push('湿地水文恢复，区域土壤含水量抬升，湿生物种压力缓解。');
  }

  if (action === 'establish_plot') {
    impact.site.disturbanceDelta = -round(0.03 * seasonFactor, 4);
    impact.target.healthDelta = round(2 * seasonFactor, 1);
    impact.target.seedBankDelta = round(carryingCapacity * 0.04 * seasonFactor, 2);
    impact.messages.push('固定样方建立，长期监测带动精细化管护。');
  }

  impact.messages.push(`占用季节修复资源 ${cost}（季节系数 ×${seasonFactor}），本季剩余 ${round(remaining - cost, 1)}。`);
  return impact;
}

/**
 * 将评估通过的修复落地到区域与物种状态（纯函数，返回新对象）。
 * 目标物种与同区域所有其他物种分别结算，避免把全部收益错记在单一物种上。
 * capacityOf 返回该物种在本区域的承载量，用于种子库上限与状态分级。
 */
export function applyRestoration(
  site: SiteState,
  states: SpeciesState[],
  targetSpeciesId: string,
  impact: RestorationImpact,
  capacityOf: (state: SpeciesState) => number | undefined
): { site: SiteState; states: SpeciesState[]; effects: RestorationImpact } {
  const nextSite: SiteState = {
    ...site,
    disturbance: clamp(site.disturbance + impact.site.disturbanceDelta, 0, 0.42),
    soilMoisture: clamp(site.soilMoisture + impact.site.soilMoistureDelta, 18, 96)
  };

  const nextStates = states.map((state) => {
    const isTarget = state.speciesId === targetSpeciesId;
    const healthDelta = isTarget ? impact.target.healthDelta : impact.cohabitants.healthDelta;
    const seedDelta = isTarget ? impact.target.seedBankDelta : impact.cohabitants.seedBankDelta;
    if (healthDelta === 0 && seedDelta === 0) {
      return state;
    }
    const capacity = capacityOf(state);
    const nextHealth = clamp(state.health + healthDelta, 0, 100);
    const rawSeed = state.seedBank + seedDelta;
    const nextSeedBank = capacity === undefined ? Math.max(0, rawSeed) : clamp(rawSeed, 0, capacity * 1.8);
    return {
      ...state,
      health: round(nextHealth, 1),
      seedBank: round(nextSeedBank, 2),
      status: capacity === undefined ? state.status : getStatus(state.population, capacity, nextHealth)
    };
  });

  return { site: nextSite, states: nextStates, effects: impact };
}
