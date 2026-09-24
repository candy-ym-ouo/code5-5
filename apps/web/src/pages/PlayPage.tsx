import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  RESTORATION_ACTIONS,
  RESTORATION_DESCRIPTIONS,
  RESTORATION_EFFORT,
  RESTORATION_LABELS,
  SEASON_LABELS,
  SLOT_LABELS,
  type GameCommand,
  type RestorationAction,
  type SampleMethod,
  type SpeciesSnapshot,
  type WorldSnapshot
} from '@shanhai/contracts';
import { useGame } from '../game-context.tsx';
import { EnvironmentForm, ObservationForm } from '../components/ObservationForm.tsx';
import { PlantGlyph } from '../components/PlantGlyph.tsx';
import { ReviewPanel } from '../components/ReviewPanel.tsx';

const SAMPLE_LABELS: Record<SampleMethod, string> = {
  photo: '拍照',
  rubbing: '叶脉拓印',
  litter: '落叶采集',
  cutting: '标准剪取'
};

const STATUS_LABELS: Record<SpeciesSnapshot['status'], string> = {
  growing: '增长',
  stable: '稳定',
  vulnerable: '脆弱',
  endangered: '濒危',
  absent: '消失'
};

export function PlayPage() {
  const { world, execute, pending } = useGame();
  const currentSite = world.sites.find((site) => site.current) ?? world.sites[0]!;
  const [selectedSpeciesId, setSelectedSpeciesId] = useState(currentSite.species[0]?.id ?? '');
  const [restoreAction, setRestoreAction] = useState<RestorationAction>('reduce_disturbance');

  useEffect(() => {
    if (!currentSite.species.some((species) => species.id === selectedSpeciesId)) {
      setSelectedSpeciesId(currentSite.species[0]?.id ?? '');
    }
  }, [currentSite, selectedSpeciesId]);

  useEffect(() => {
    if (currentSite.id !== 'stream_valley' && restoreAction === 'restore_wetland') {
      setRestoreAction('reduce_disturbance');
    }
  }, [currentSite.id, restoreAction]);

  const selectedSpecies = useMemo(
    () => currentSite.species.find((species) => species.id === selectedSpeciesId) ?? currentSite.species[0] ?? null,
    [currentSite, selectedSpeciesId]
  );

  const run = async (command: GameCommand): Promise<boolean> => {
    try {
      await execute(command);
      return true;
    } catch {
      return false;
    }
  };

  return (
    <div className="play-layout">
      <section className="world-column">
        <div className="field-heading">
          <div>
            <p className="eyebrow">FIELD SITE · {currentSite.name}</p>
            <h1>{world.year} 年 {SEASON_LABELS[world.season]}季 · 第 {world.day} 日</h1>
            <p>{currentSite.description}</p>
          </div>
          <div className="time-chip">
            <span>{SLOT_LABELS[world.slot - 1] ?? '暮'}</span>
            <strong>{world.actionPoints} AP</strong>
          </div>
        </div>

        {world.phase !== 'active' ? (
          <ReviewPanel
            world={world}
            busy={pending}
            onContinueSeason={() => void run({ type: 'BEGIN_NEXT_SEASON' })}
            onContinueYear={() => void run({ type: 'BEGIN_NEXT_YEAR' })}
          />
        ) : (
          <>
            <div className="map-and-weather">
              <div className="mountain-map">
                <div className="map-contours" aria-hidden="true" />
                {world.sites.map((site) => (
                  <button
                    key={site.id}
                    type="button"
                    className={`map-stop ${site.current ? 'active' : ''}`}
                    style={{ left: `${site.mapX}%`, top: `${site.mapY}%` }}
                    onClick={() => {
                      if (!site.current) void run({ type: 'MOVE_ZONE', siteId: site.id });
                    }}
                    disabled={pending}
                  >
                    <span>{site.name}</span>
                    <small>{site.species.length} 个对象</small>
                  </button>
                ))}
                <div className="map-path" aria-hidden="true" />
              </div>
              <aside className="weather-card">
                <span className="weather-symbol">{weatherSymbol(currentSite.environment.weather)}</span>
                <div>
                  <p className="eyebrow">CURRENT ENVIRONMENT</p>
                  <h2>{weatherLabel(currentSite.environment.weather)}</h2>
                </div>
                <dl>
                  <div><dt>温度</dt><dd>{currentSite.environment.temperatureC.toFixed(1)}°C</dd></div>
                  <div><dt>湿度</dt><dd>{currentSite.environment.humidity.toFixed(0)}%</dd></div>
                  <div><dt>土壤</dt><dd>{currentSite.environment.soilMoisture.toFixed(0)}%</dd></div>
                  <div><dt>光照</dt><dd>{Math.round(currentSite.environment.lightLux).toLocaleString()} lux</dd></div>
                  <div><dt>风速</dt><dd>{currentSite.environment.windSpeed.toFixed(1)} m/s</dd></div>
                  <div><dt>干扰</dt><dd>{Math.round(currentSite.environment.disturbance * 100)}%</dd></div>
                </dl>
                <button className="button button-quiet full-width" type="button" onClick={() => void run({ type: 'WAIT' })} disabled={pending}>
                  原地等待一轮
                </button>
              </aside>
            </div>

            <section className="site-species">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">VISIBLE SUBJECTS</p>
                  <h2>当前可观察对象</h2>
                </div>
                <span>选择一个对象填写观察笔记</span>
              </div>
              <div className="species-strip">
                {currentSite.species.map((species) => (
                  <button
                    type="button"
                    key={species.id}
                    className={`species-tab ${selectedSpecies?.id === species.id ? 'active' : ''}`}
                    onClick={() => setSelectedSpeciesId(species.id)}
                  >
                    <span className="species-dot" style={{ background: species.phenology.dominantColor }} />
                    <span>
                      <strong>{species.name}</strong>
                      <small>{STATUS_LABELS[species.status]} · 健康 {Math.round(species.health)}</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {selectedSpecies && (
              <section className="species-workspace">
                <div className="species-visual">
                  <PlantGlyph species={selectedSpecies} large />
                  <div className={`habitat-status status-${selectedSpecies.status}`}>
                    <span>区域状态</span>
                    <strong>{STATUS_LABELS[selectedSpecies.status]}</strong>
                  </div>
                  <dl className="species-metrics">
                    <div><dt>种群</dt><dd>{selectedSpecies.population.toFixed(0)}</dd></div>
                    <div><dt>承载量</dt><dd>{selectedSpecies.carryingCapacity}</dd></div>
                    <div><dt>健康</dt><dd>{selectedSpecies.health.toFixed(0)}</dd></div>
                    <div><dt>种子库</dt><dd>{selectedSpecies.seedBank.toFixed(0)}</dd></div>
                  </dl>
                  <Link className="text-link" to={`/play/species/${selectedSpecies.id}`}>查看物种档案 →</Link>
                </div>
                <div className="notebook-sheet">
                  <div className="sheet-heading">
                    <div>
                      <p className="eyebrow">OBSERVATION NOTE</p>
                      <h2>{selectedSpecies.name}</h2>
                      <p><i>{selectedSpecies.latinName}</i> · 当前可见形态颜色 <span className="inline-color" style={{ background: selectedSpecies.phenology.dominantColor }} /></p>
                    </div>
                    {selectedSpecies.protected && <span className="protected-badge">保护物种</span>}
                  </div>
                  <ObservationForm
                    key={`${selectedSpecies.id}-${world.revision}`}
                    species={selectedSpecies}
                    site={currentSite}
                    busy={pending}
                    onSubmit={(values) => run({ type: 'OBSERVE_PLANT', speciesId: selectedSpecies.id, values })}
                  />
                </div>
              </section>
            )}

            <section className="field-tools">
              <div className="tool-card">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">SAMPLING PROTOCOL</p>
                    <h2>采集方式</h2>
                  </div>
                </div>
                <p className="helper-text">绿色表示安全且当前可用。错误协议仍可能执行，但会真实影响生态。</p>
                <div className="sample-grid">
                  {(Object.keys(SAMPLE_LABELS) as SampleMethod[]).map((method) => {
                    const limit = selectedSpecies?.sampleLimits[method];
                    return (
                      <button
                        key={method}
                        type="button"
                        className="sample-button"
                        disabled={pending || !selectedSpecies || !limit?.allowed}
                        onClick={() => {
                          if (selectedSpecies) void run({ type: 'TAKE_SAMPLE', speciesId: selectedSpecies.id, method });
                        }}
                      >
                        <strong>{SAMPLE_LABELS[method]}</strong>
                        <span>{limit ? `${limit.used}/${limit.limit}` : '不可用'}</span>
                        {limit?.reason && <small>{limit.reason}</small>}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="tool-card">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">ENVIRONMENT STATION</p>
                    <h2>环境记录</h2>
                  </div>
                </div>
                <EnvironmentForm
                  key={`${currentSite.id}-${world.revision}`}
                  site={currentSite}
                  busy={pending}
                  onSubmit={(values) => run({ type: 'RECORD_ENVIRONMENT', values })}
                />
              </div>
            </section>

            {world.restorationUnlocked && selectedSpecies && (
              <RestorationCard
                key={`${currentSite.id}-${world.year}-${world.season}`}
                site={currentSite}
                action={restoreAction}
                onActionChange={setRestoreAction}
                busy={pending}
                actionPoints={world.actionPoints}
                onExecute={(nextAction) =>
                  run({ type: 'RESTORE_HABITAT', speciesId: selectedSpecies.id, action: nextAction })
                }
              />
            )}

            <div className="end-season-bar">
              <div>
                <strong>本季第 {world.day} 日</strong>
                <span>{world.day < 8 ? '第 8 日后可结束季节结算' : '环境与采集影响已准备结算'}</span>
              </div>
              <button
                className="button button-primary"
                type="button"
                disabled={pending || world.day < 8 || world.actionPoints > 0 && world.day >= 10}
                onClick={() => void run({ type: 'END_SEASON' })}
              >
                结束 {SEASON_LABELS[world.season]}季
              </button>
            </div>
          </>
        )}
      </section>

      <aside className="event-rail">
        <div className="section-heading">
          <div>
            <p className="eyebrow">FIELD EVENTS</p>
            <h2>最近变化</h2>
          </div>
        </div>
        <div className="event-list">
          {world.recentEvents.length === 0 && <p className="empty-copy">还没有事件。开始移动、观察或记录环境。</p>}
          {world.recentEvents.map((event) => (
            <article key={event.id}>
              <span>#{event.sequence}</span>
              <strong>{event.message}</strong>
              <ul>
                {event.effects.map((effect) => <li key={effect}>{effect}</li>)}
              </ul>
              <time>{new Date(event.createdAt).toLocaleString('zh-CN', { hour12: false })}</time>
            </article>
          ))}
        </div>
      </aside>
    </div>
  );
}

function weatherSymbol(weather: string): string {
  return ({ sunny: '☀', cloudy: '◒', overcast: '☁', light_rain: '☂', heavy_rain: '☔', fog: '≋', snow: '❄' } as Record<string, string>)[weather] ?? '◌';
}

function weatherLabel(weather: string): string {
  return ({ sunny: '晴', cloudy: '多云', overcast: '阴', light_rain: '小雨', heavy_rain: '大雨', fog: '雾', snow: '雪' } as Record<string, string>)[weather] ?? weather;
}

interface RestorationCardProps {
  site: WorldSnapshot['sites'][number];
  action: RestorationAction;
  onActionChange: (action: RestorationAction) => void;
  busy: boolean;
  actionPoints: number;
  onExecute: (action: RestorationAction) => void;
}

function RestorationCard({ site, action, onActionChange, busy, actionPoints, onExecute }: RestorationCardProps) {
  const budget = site.restoration;
  const effort = RESTORATION_EFFORT[action];
  const affordable = budget.remaining >= effort;
  const wetlandLocked = action === 'restore_wetland' && site.id !== 'stream_valley';
  const usedActions = new Set(budget.projects.map((project) => project.action));
  const alreadyPlanned = usedActions.has(action);
  const disabled = busy || actionPoints < 2 || !affordable || wetlandLocked || alreadyPlanned;
  const denyReason = wetlandLocked
    ? '恢复湿生带只能在溪谷湿地执行'
    : alreadyPlanned
      ? '本季已在该区域执行过该措施，重复修复不叠加收益'
      : !affordable
        ? `本季修复资源不足（剩余 ${budget.remaining} / 需要 ${effort}）`
        : actionPoints < 2
          ? '需要 2 个行动点'
          : null;

  return (
    <section className="restoration-card">
      <div>
        <p className="eyebrow">RESTORATION UNLOCKED</p>
        <h2>把年报结论变成行动</h2>
        <p>同区域同季节的措施争夺有限修复资源，后执行的措施竞争效率更低；重复措施不会叠加收益。</p>
      </div>

      <div className="restoration-budget" aria-label={`本季修复资源 ${budget.remaining}/${budget.capacity}`}>
        <div className="restoration-budget-head">
          <span>本季修复资源 · {site.name}</span>
          <strong>{budget.remaining}/{budget.capacity}</strong>
        </div>
        <div className="restoration-budget-track">
          <div className="restoration-budget-used" style={{ width: `${(budget.effortUsed / budget.capacity) * 100}%` }} />
        </div>
        <div className="restoration-budget-meta">
          <span>已投入 {budget.effortUsed} 点</span>
          <span>下一措施效率约 {Math.round(budget.nextEfficiency * 100)}%</span>
        </div>
        {budget.projects.length > 0 && (
          <ul className="restoration-project-list">
            {budget.projects.map((project) => (
              <li key={project.sequence}>
                <span>{project.label} · {project.targetSpeciesName}</span>
                <small>第 {project.day} 日 · {project.effort} 点 · 效率 {Math.round(project.efficiency * 100)}%</small>
              </li>
            ))}
          </ul>
        )}
      </div>

      <label>
        <span>修复方式（占用资源 / 作用范围）</span>
        <select value={action} onChange={(event) => onActionChange(event.target.value as RestorationAction)}>
          {RESTORATION_ACTIONS.map((value) => (
            <option key={value} value={value} disabled={value === 'restore_wetland' && site.id !== 'stream_valley'}>
              {RESTORATION_LABELS[value]}（{RESTORATION_EFFORT[value]} 点{value === 'protect_seed_bank' ? ' · 仅目标物种' : ' · 区域协同'}）
            </option>
          ))}
        </select>
      </label>
      <p className="restoration-description">{RESTORATION_DESCRIPTIONS[action]}</p>
      {denyReason && <p className="restoration-deny">{denyReason}</p>}
      <button className="button button-secondary" type="button" disabled={disabled} onClick={() => onExecute(action)}>
        执行修复（2 行动点）
      </button>
    </section>
  );
}
