import { RESTORATION_SEASON_CAPACITY as SHARED_CAPACITY, type RestorationAction, type Season, type SiteId } from '@shanhai/contracts';
import { clamp, getStatus, round } from './simulation.ts';
import type { SiteState, SpeciesState } from './types.ts';

/**
 * 季节修复资源（本季可投入的工日/物料容量）。
 * 同一区域、同一季节内，不同修复措施争夺这一份有限资源：
 * 投入越多，边际效率越低（季节窗口与施工力量有限）。
 */
export const RESTORATION_SEASON_CAPACITY: number = SHARED_CAPACITY;

export const RESTORATION_SITE_SCOPED: ReadonlySet<RestorationAction> = new Set([
  'reduce_disturbance',
  'restore_wetland'
]);

export interface RestorationBlueprint {
  action: RestorationAction;
  label: string;
  effort: number;
  siteScoped: boolean;
  /** 执行瞬间对区域干扰的削减（乘以竞争效率）。 */
  disturbanceDelta: number;
  /** 执行瞬间对目标物种健康度的提升（乘以竞争效率）。 */
  targetHealthDelta: number;
  /** 执行瞬间对目标物种种子库的补给比例（相对区域容纳量，乘以竞争效率）。 */
  targetSeedBankRatio: number;
  /** 季末结算是否向同区域其他物种外溢。 */
  spillover: boolean;
}

export const RESTORATION_BLUEPRINTS: Record<RestorationAction, RestorationBlueprint> = {
  reduce_disturbance: {
    action: 'reduce_disturbance',
    label: '降低区域干扰',
    effort: 3,
    siteScoped: true,
    disturbanceDelta: -0.07,
    targetHealthDelta: 3,
    targetSeedBankRatio: 0,
    spillover: true
  },
  protect_seed_bank: {
    action: 'protect_seed_bank',
    label: '保留种子区',
    effort: 2,
    siteScoped: false,
    disturbanceDelta: 0,
    targetHealthDelta: 0,
    targetSeedBankRatio: 0.1,
    spillover: false
  },
  restore_wetland: {
    action: 'restore_wetland',
    label: '恢复湿生带',
    effort: 4,
    siteScoped: true,
    disturbanceDelta: -0.1,
    targetHealthDelta: 4,
    targetSeedBankRatio: 0,
    spillover: true
  },
  establish_plot: {
    action: 'establish_plot',
    label: '设置长期观察样方',
    effort: 2,
    siteScoped: false,
    disturbanceDelta: 0,
    targetHealthDelta: 2,
    targetSeedBankRatio: 0.04,
    spillover: true
  }
};

export interface RestorationProject {
  saveId: string;
  year: number;
  season: Season;
  siteId: SiteId;
  sequence: number;
  action: RestorationAction;
  /** 区域级措施记为 '*'，物种级措施记为目标物种。 */
  scopeSpeciesId: '*' | string;
  targetSpeciesId: string;
  effort: number;
  efficiency: number;
  day: number;
  createdAt?: string;
}

/**
 * 季节资源竞争效率：
 * 在已投入 effortUsed 的容量后再执行修复时，按容量占用比例线性衰减，
 * 首个措施为 100%，最低保留 0.55，避免季节末段的措施完全失效。
 */
export function restorationEfficiency(effortUsed: number): number {
  return round(clamp(1 - (0.45 * effortUsed) / RESTORATION_SEASON_CAPACITY, 0.55, 1), 3);
}

export function restorationRemaining(projects: Pick<RestorationProject, 'effort'>[]): number {
  const used = projects.reduce((sum, project) => sum + project.effort, 0);
  return RESTORATION_SEASON_CAPACITY - used;
}

export interface RestorationEffects {
  disturbanceDelta: number;
  healthDelta: number;
  seedBankDelta: number;
  recruitmentDelta: number;
  efficiency: number;
}

/**
 * 计算一次修复执行“瞬间”的确定性效果（作用于区域与目标物种）。
 * 不做任何边界裁剪，由 applyRestorationImmediate 统一裁剪落库。
 */
export function planRestoration(
  action: RestorationAction,
  carryingCapacity: number,
  effortUsed: number
): RestorationEffects {
  const blueprint = RESTORATION_BLUEPRINTS[action];
  const efficiency = restorationEfficiency(effortUsed);
  return {
    disturbanceDelta: blueprint.disturbanceDelta * efficiency,
    healthDelta: blueprint.targetHealthDelta * efficiency,
    seedBankDelta: blueprint.targetSeedBankRatio * carryingCapacity * efficiency,
    // 区域性措施当季即可为目标物种补充极少量可繁殖个体。
    recruitmentDelta: blueprint.siteScoped ? 1.5 * efficiency : 0,
    efficiency
  };
}

/** 将瞬间效果落到区域状态上（纯函数）。 */
export function applySiteRestoration(site: SiteState, effects: RestorationEffects): SiteState {
  if (effects.disturbanceDelta === 0) {
    return site;
  }
  return { ...site, disturbance: round(clamp(site.disturbance + effects.disturbanceDelta, 0, 0.42), 4) };
}

/** 将瞬间效果落到目标物种状态上（纯函数）。 */
export function applyRestorationImmediate(
  state: SpeciesState,
  effects: RestorationEffects,
  carryingCapacity: number
): SpeciesState {
  const health = clamp(state.health + effects.healthDelta, 0, 100);
  const seedBank = clamp(state.seedBank + effects.seedBankDelta, 0, carryingCapacity * 1.8);
  const population = clamp(state.population + effects.recruitmentDelta, 0, carryingCapacity * 1.2);
  return {
    ...state,
    health: round(health, 1),
    seedBank: round(seedBank, 2),
    population: round(population, 2),
    status: getStatus(population, carryingCapacity, health)
  };
}

/**
 * 季末结算时单个措施对“一个物种区域种群”的外溢/延续效果。
 * 区域级措施：目标物种只取健康收益的一部分（瞬间已得主要收益），
 *            同区域其他物种获得完整区域协同收益；
 * 物种级措施（保留种子区）：只作用于目标物种，不产生区域外溢；
 * 样方虽针对单一物种设立，但监测与微生境改善会轻微惠及全区域。
 */
export function projectSettlementEffects(
  project: RestorationProject,
  state: SpeciesState,
  carryingCapacity: number
): RestorationEffects {
  const effortFactor = (project.effort * project.efficiency) / RESTORATION_SEASON_CAPACITY;
  const isTarget = project.targetSpeciesId === state.speciesId;

  if (project.action === 'protect_seed_bank') {
    return isTarget
      ? { disturbanceDelta: 0, healthDelta: 0, seedBankDelta: carryingCapacity * 0.06 * project.efficiency, recruitmentDelta: 0, efficiency: project.efficiency }
      : ZERO_EFFECTS;
  }

  if (project.action === 'reduce_disturbance') {
    return {
      disturbanceDelta: 0,
      healthDelta: isTarget ? 1.5 : 3,
      seedBankDelta: 0,
      recruitmentDelta: isTarget ? 0 : 1.5 * effortFactor,
      efficiency: project.efficiency
    };
  }

  if (project.action === 'restore_wetland') {
    return {
      disturbanceDelta: 0,
      healthDelta: isTarget ? 2 : 4,
      seedBankDelta: carryingCapacity * (isTarget ? 0.02 : 0.05),
      recruitmentDelta: isTarget ? 0 : 2 * effortFactor,
      efficiency: project.efficiency
    };
  }

  // establish_plot：目标物种延续收益较高，其他物种仅获得轻微区域协同。
  return {
    disturbanceDelta: 0,
    healthDelta: isTarget ? 2.5 * project.efficiency : 0.8,
    seedBankDelta: isTarget ? carryingCapacity * 0.03 * project.efficiency : carryingCapacity * 0.01,
    recruitmentDelta: isTarget ? 0 : 0.6 * effortFactor,
    efficiency: project.efficiency
  };
}

const ZERO_EFFECTS: RestorationEffects = {
  disturbanceDelta: 0,
  healthDelta: 0,
  seedBankDelta: 0,
  recruitmentDelta: 0,
  efficiency: 1
};

export function sumRestorationEffects(effectsList: RestorationEffects[]): RestorationEffects {
  const total = effectsList.reduce(
    (sum, effects) => ({
      disturbanceDelta: sum.disturbanceDelta + effects.disturbanceDelta,
      healthDelta: sum.healthDelta + effects.healthDelta,
      seedBankDelta: sum.seedBankDelta + effects.seedBankDelta,
      recruitmentDelta: sum.recruitmentDelta + effects.recruitmentDelta
    }),
    { disturbanceDelta: 0, healthDelta: 0, seedBankDelta: 0, recruitmentDelta: 0 }
  );
  return { ...total, efficiency: 1 };
}

/**
 * 季末结算：把本季全部修复项目的延续/协同效果作用于区域内物种状态。
 * 在 evolveSeason 之前调用，使修复收益通过季节演化真正进入种群动态。
 */
export function settleRestorationSeason(
  projects: RestorationProject[],
  states: SpeciesState[],
  carryingCapacityOf: (siteId: SiteId, speciesId: string) => number | undefined
): SpeciesState[] {
  if (projects.length === 0) {
    return states;
  }
  const projectsBySite = new Map<SiteId, RestorationProject[]>();
  for (const project of projects) {
    const list = projectsBySite.get(project.siteId) ?? [];
    list.push(project);
    projectsBySite.set(project.siteId, list);
  }

  return states.map((state) => {
    const siteProjects = projectsBySite.get(state.siteId);
    if (!siteProjects || siteProjects.length === 0) {
      return state;
    }
    const carryingCapacity = carryingCapacityOf(state.siteId, state.speciesId);
    if (carryingCapacity === undefined) {
      return state;
    }
    const effects = sumRestorationEffects(
      siteProjects.map((project) => projectSettlementEffects(project, state, carryingCapacity))
    );
    if (
      effects.healthDelta === 0 &&
      effects.seedBankDelta === 0 &&
      effects.recruitmentDelta === 0 &&
      effects.disturbanceDelta === 0
    ) {
      return state;
    }
    const health = clamp(state.health + effects.healthDelta, 0, 100);
    const seedBank = clamp(state.seedBank + effects.seedBankDelta, 0, carryingCapacity * 1.8);
    const population = clamp(state.population + effects.recruitmentDelta, 0, carryingCapacity * 1.2);
    return {
      ...state,
      health: round(health, 1),
      seedBank: round(seedBank, 2),
      population: round(population, 2),
      status: getStatus(population, carryingCapacity, health)
    };
  });
}
