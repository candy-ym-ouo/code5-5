import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  RESTORATION_ACTIONS,
  SEASON_LABELS,
  SLOT_LABELS,
  type GameCommand,
  type RestorationAction,
  type SampleMethod,
  type SpeciesSnapshot
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

const RESTORATION_UI: Record<RestorationAction, { label: string; baseCost: Record<string, number>; hint: string }> = {
  reduce_disturbance: { label: '降低区域干扰', baseCost: { spring: 1, summer: 1, autumn: 1, winter: 1 }, hint: '干扰下降，惠及同区物种' },
  protect_seed_bank: { label: '保留种子区', baseCost: { spring: 0.7, summer: 0.9, autumn: 1.3, winter: 1 }, hint: '秋季最强但最耗资源' },
  restore_wetland: { label: '恢复湿生带', baseCost: { spring: 1.1, summer: 1.3, autumn: 0.9, winter: 0.7 }, hint: '仅溪谷湿地，抬升土壤含水' },
  establish_plot: { label: '设置长期观察样方', baseCost: { spring: 1.2, summer: 1, autumn: 0.9, winter: 0.8 }, hint: '小幅改善健康与种子库' }
};

function restorationCost(action: RestorationAction, season: string): number {
  const base = RESTORATION_UI[action].baseCost[season] ?? 1;
  return Math.round(base * 10) / 10;
}

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

  // 资源耗尽或本季已执行过的措施不可重复加成，自动跳到首个仍可执行的措施。
  useEffect(() => {
    const currentCost = restorationCost(restoreAction, world.season);
    const blocked =
      currentSite.restorations.some((item) => item.action === restoreAction) ||
      (restoreAction === 'restore_wetland' && currentSite.id !== 'stream_valley') ||
      world.restorationBudget.remaining + 1e-9 < currentCost;
    if (!blocked) return;
    const fallback = RESTORATION_ACTIONS.find((action) => {
      if (currentSite.restorations.some((item) => item.action === action)) return false;
      if (action === 'restore_wetland' && currentSite.id !== 'stream_valley') return false;
      return world.restorationBudget.remaining + 1e-9 >= restorationCost(action, world.season);
    });
    if (fallback) setRestoreAction(fallback);
  }, [currentSite, world.season, world.restorationBudget.remaining, restoreAction]);

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
              <section className="restoration-card">
                <div>
                  <p className="eyebrow">RESTORATION UNLOCKED</p>
                  <h2>把年报结论变成行动</h2>
                  <p>修复行动消耗 2 个行动点。四项措施争夺本季共享的修复资源，同区同措施每季只能生效一次。</p>
                </div>
                <div className="restoration-budget" aria-label="本季修复资源">
                  <span>本季修复资源</span>
                  <div className="budget-bar">
                    <i style={{ width: `${Math.min(100, (world.restorationBudget.spent / world.restorationBudget.total) * 100)}%` }} />
                  </div>
                  <strong>
                    {world.restorationBudget.remaining}/{world.restorationBudget.total} 可用
                  </strong>
                </div>
                <div className="restoration-options">
                  {RESTORATION_ACTIONS.map((action) => {
                    const cost = restorationCost(action, world.season);
                    const siteWide = currentSite.restorations.some((item) => item.action === action);
                    const wetlandLocked = action === 'restore_wetland' && currentSite.id !== 'stream_valley';
                    const affordable = world.restorationBudget.remaining + 1e-9 >= cost;
                    const disabled = siteWide || wetlandLocked || !affordable || world.actionPoints < 2 || pending;
                    const reason = wetlandLocked
                      ? '仅溪谷湿地'
                      : siteWide
                        ? '本季已执行，不可叠加'
                        : !affordable
                          ? '季节资源不足'
                          : undefined;
                    return (
                      <button
                        key={action}
                        type="button"
                        className={`restoration-option ${restoreAction === action ? 'active' : ''} ${disabled && restoreAction !== action ? 'is-locked' : ''}`}
                        disabled={disabled && restoreAction !== action}
                        onClick={() => setRestoreAction(action)}
                      >
                        <strong>{RESTORATION_UI[action].label}</strong>
                        <small>{RESTORATION_UI[action].hint}</small>
                        <span className="restoration-cost">
                          季节资源 {cost} · 目标 {currentSite.restorations.find((item) => item.action === action)?.speciesName ?? '—'}
                        </span>
                        {reason && <em className="restoration-lock">{reason}</em>}
                      </button>
                    );
                  })}
                </div>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={
                    pending ||
                    world.actionPoints < 2 ||
                    currentSite.restorations.some((item) => item.action === restoreAction) ||
                    (restoreAction === 'restore_wetland' && currentSite.id !== 'stream_valley') ||
                    world.restorationBudget.remaining + 1e-9 < restorationCost(restoreAction, world.season)
                  }
                  onClick={() => void run({ type: 'RESTORE_HABITAT', speciesId: selectedSpecies.id, action: restoreAction })}
                >
                  执行修复（{RESTORATION_UI[restoreAction].label}）
                </button>
                {currentSite.restorations.length > 0 && (
                  <ul className="restoration-log">
                    {currentSite.restorations.map((item) => (
                      <li key={`${item.action}-${item.day}`}>
                        第 {item.day} 日 · {item.label} · {item.speciesName} · 占用 {item.resourcesSpent}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
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
