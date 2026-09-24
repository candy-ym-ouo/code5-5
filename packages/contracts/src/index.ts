import { z } from 'zod';

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];

export const SITE_IDS = ['foothill', 'mixed_forest', 'stream_valley', 'ridge'] as const;
export type SiteId = (typeof SITE_IDS)[number];

export const PHASES = ['active', 'season_review', 'year_review'] as const;
export type GamePhase = (typeof PHASES)[number];

export const PHENOLOGY_STAGES = [
  'leafing',
  'budding',
  'early_bloom',
  'full_bloom',
  'late_bloom',
  'fruiting',
  'leaf_color',
  'leaf_fall',
  'dormant'
] as const;
export type PhenologyStage = (typeof PHENOLOGY_STAGES)[number];

export const LEAF_TEXTURES = ['smooth', 'leathery', 'rough', 'pubescent', 'waxy', 'needle', 'compound'] as const;
export type LeafTexture = (typeof LEAF_TEXTURES)[number];

export const SAMPLE_METHODS = ['photo', 'rubbing', 'litter', 'cutting'] as const;
export type SampleMethod = (typeof SAMPLE_METHODS)[number];

export const RESTORATION_ACTIONS = [
  'reduce_disturbance',
  'protect_seed_bank',
  'restore_wetland',
  'establish_plot'
] as const;
export type RestorationAction = (typeof RESTORATION_ACTIONS)[number];

const ObservationValuesSchema = z.object({
  phenology: z.enum(PHENOLOGY_STAGES),
  leafTexture: z.enum(LEAF_TEXTURES),
  dominantColor: z.string().trim().min(1).max(30),
  temperatureC: z.number().min(-30).max(50),
  humidity: z.number().min(0).max(100),
  soilMoisture: z.number().min(0).max(100),
  lightLux: z.number().min(0).max(200000),
  note: z.string().trim().max(500).default('')
});

const EnvironmentValuesSchema = z.object({
  temperatureC: z.number().min(-30).max(50),
  humidity: z.number().min(0).max(100),
  soilMoisture: z.number().min(0).max(100),
  lightLux: z.number().min(0).max(200000),
  note: z.string().trim().max(500).default('')
});

export const CommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('MOVE_ZONE'), siteId: z.enum(SITE_IDS) }),
  z.object({ type: z.literal('WAIT') }),
  z.object({ type: z.literal('OBSERVE_PLANT'), speciesId: z.string().min(1), values: ObservationValuesSchema }),
  z.object({ type: z.literal('RECORD_ENVIRONMENT'), values: EnvironmentValuesSchema }),
  z.object({ type: z.literal('TAKE_SAMPLE'), speciesId: z.string().min(1), method: z.enum(SAMPLE_METHODS) }),
  z.object({
    type: z.literal('RESTORE_HABITAT'),
    speciesId: z.string().min(1),
    action: z.enum(RESTORATION_ACTIONS)
  }),
  z.object({ type: z.literal('END_SEASON') }),
  z.object({ type: z.literal('BEGIN_NEXT_SEASON') }),
  z.object({ type: z.literal('BEGIN_NEXT_YEAR') })
]);

export type GameCommand = z.infer<typeof CommandSchema>;

export const CommandRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string().trim().min(8).max(120),
  command: CommandSchema
});
export type CommandRequest = z.infer<typeof CommandRequestSchema>;

export const ImportSaveSchema = z.object({
  token: z.string().trim().min(20)
});

export const PublicSiteSchema = z.object({
  id: z.enum(SITE_IDS),
  name: z.string(),
  habitat: z.string(),
  description: z.string(),
  mapX: z.number(),
  mapY: z.number()
});

export const PublicSpeciesSchema = z.object({
  id: z.string(),
  name: z.string(),
  latinName: z.string(),
  lifeForm: z.string(),
  description: z.string(),
  protected: z.boolean()
});

export interface CatalogMeta {
  version: string;
  sites: Array<z.infer<typeof PublicSiteSchema>>;
  species: Array<z.infer<typeof PublicSpeciesSchema>>;
}

export interface RestorationProjectSnapshot {
  sequence: number;
  action: RestorationAction;
  label: string;
  targetSpeciesId: string;
  targetSpeciesName: string;
  effort: number;
  efficiency: number;
  day: number;
  createdAt: string;
}

export interface SiteRestorationSnapshot {
  capacity: number;
  effortUsed: number;
  remaining: number;
  nextEfficiency: number;
  projects: RestorationProjectSnapshot[];
}

export interface SiteSnapshot {
  id: SiteId;
  name: string;
  habitat: string;
  description: string;
  mapX: number;
  mapY: number;
  current: boolean;
  environment: {
    weather: string;
    temperatureC: number;
    humidity: number;
    soilMoisture: number;
    lightLux: number;
    windSpeed: number;
    disturbance: number;
  };
  restoration: SiteRestorationSnapshot;
  species: SpeciesSnapshot[];
}

export interface SpeciesSnapshot {
  id: string;
  name: string;
  latinName: string;
  lifeForm: string;
  protected: boolean;
  population: number;
  carryingCapacity: number;
  health: number;
  seedBank: number;
  suitability: number;
  status: 'growing' | 'stable' | 'vulnerable' | 'endangered' | 'absent';
  phenology: {
    stage: PhenologyStage;
    label: string;
    dominantColor: string;
    leafTexture: LeafTexture;
    bloomStartDay: number;
    bloomPeakDay: number;
    bloomEndDay: number;
  };
  sampleLimits: Record<SampleMethod, { used: number; limit: number; allowed: boolean; reason?: string }>;
  unlocked: boolean;
}

export interface RecentEvent {
  id: string;
  sequence: number;
  type: string;
  message: string;
  effects: string[];
  createdAt: string;
}

export interface SeasonReview {
  year: number;
  season: Season;
  observationCount: number;
  averageObservationScore: number;
  sampleCount: number;
  incorrectSamples: number;
  changes: string[];
}

export interface AnnualReview {
  year: number;
  headline: string;
  populationChangePercent: number;
  speciesChanges: Array<{
    speciesId: string;
    name: string;
    populationChangePercent: number;
    healthChange: number;
    status: string;
  }>;
  distributionChanges: string[];
  incorrectSamples: number;
  recommendations: string[];
  restorationUnlocked: boolean;
  restorationProjects: Array<{
    siteId: SiteId;
    siteName: string;
    action: RestorationAction;
    label: string;
    targetSpeciesName: string;
    count: number;
    effort: number;
  }>;
}

export interface CommandHistoryEntry {
  sequence: number;
  revision: number;
  command: GameCommand;
  idempotencyKey: string;
  eventType: string;
  eventMessage: string;
  createdAt: string;
}

export interface ReplayResult {
  saveId: string;
  commandsReplayed: number;
  revisionMatch: boolean;
  yearMatch: boolean;
  seasonMatch: boolean;
  stateMatch: boolean;
  match: boolean;
  firstDifference: { table: string; expected: unknown; actual: unknown } | null;
}

export interface WorldSnapshot {
  saveId: string;
  revision: number;
  year: number;
  season: Season;
  seasonLabel: string;
  day: number;
  slot: number;
  actionPoints: number;
  phase: GamePhase;
  currentSiteId: SiteId;
  restorationUnlocked: boolean;
  sites: SiteSnapshot[];
  recentEvents: RecentEvent[];
  seasonReview: SeasonReview | null;
  annualReview: AnnualReview | null;
}

export interface JournalEntry {
  id: string;
  kind: 'plant' | 'environment' | 'sample';
  year: number;
  season: Season;
  day: number;
  slot: number;
  siteId: SiteId;
  siteName: string;
  speciesId: string | null;
  speciesName: string | null;
  score: number | null;
  note: string;
  createdAt: string;
  details: Record<string, unknown>;
}

export interface ApiErrorShape {
  code: string;
  message: string;
  details?: unknown;
  traceId: string;
  retryable: boolean;
}

export const SEASON_LABELS: Record<Season, string> = {
  spring: '春',
  summer: '夏',
  autumn: '秋',
  winter: '冬'
};

export const RESTORATION_LABELS: Record<RestorationAction, string> = {
  reduce_disturbance: '降低区域干扰',
  protect_seed_bank: '保留种子区',
  restore_wetland: '恢复湿生带',
  establish_plot: '设置长期观察样方'
};

/** 每项措施占用的季节修复资源（工日/物料）。 */
export const RESTORATION_EFFORT: Record<RestorationAction, number> = {
  reduce_disturbance: 3,
  protect_seed_bank: 2,
  restore_wetland: 4,
  establish_plot: 2
};

/** 每区域每季节的修复资源总容量。 */
export const RESTORATION_SEASON_CAPACITY = 6;

export const RESTORATION_DESCRIPTIONS: Record<RestorationAction, string> = {
  reduce_disturbance: '全区域围栏与巡护：当季降低干扰，并在季末惠及区域内全部物种',
  protect_seed_bank: '针对单一物种围护种子库：仅增强目标物种的越冬补给',
  restore_wetland: '仅溪谷湿地可执行：区域水文恢复，季末惠及区域内全部湿生物种',
  establish_plot: '针对目标物种设立长期样方：小幅改善目标物种，季末轻微惠及全区域'
};

export const SLOT_LABELS = ['晨', '午', '暮'];
