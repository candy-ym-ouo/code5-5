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

/** 每季共享的修复资源（工时/物资）总量，所有措施在同一预算池内竞争。 */
export const SEASONAL_RESTORATION_BUDGET = 6;

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
  restoration: {
    seasonalBudget: number;
    actions: Array<{
      id: RestorationAction;
      label: string;
      description: string;
      seasonalCosts: Record<Season, number>;
    }>;
  };
}

export interface ActiveRestoration {
  action: RestorationAction;
  label: string;
  speciesId: string;
  speciesName: string;
  resourcesSpent: number;
  day: number;
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
  species: SpeciesSnapshot[];
  restorations: ActiveRestoration[];
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
  restorationBudget: {
    total: number;
    spent: number;
    remaining: number;
  };
  sites: SiteSnapshot[];
  recentEvents: RecentEvent[];
  seasonReview: SeasonReview | null;
  annualReview: AnnualReview | null;
}

export interface CommandHistoryEntry {
  sequence: number;
  revision: number;
  type: GameCommand['type'];
  command: GameCommand;
  siteId: SiteId | null;
  createdAt: string;
}

export interface ReplayMismatch {
  scope: 'save' | 'site' | 'species' | 'count';
  key: string;
  field?: string;
  expected: unknown;
  actual: unknown;
}

export interface ReplayReport {
  replayedCommands: number;
  finalRevision: number;
  matches: boolean;
  mismatchCount: number;
  mismatches: ReplayMismatch[];
  checkedAt: string;
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

export const SLOT_LABELS = ['晨', '午', '暮'];
