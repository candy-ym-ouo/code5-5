import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { ReplayResult } from '@shanhai/contracts';
import { api, ApiError } from '../api.ts';
import { useGame } from '../game-context.tsx';

export function SettingsPage() {
  const { world } = useGame();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [exportToken, setExportToken] = useState('');
  const [message, setMessage] = useState('');
  const [replayResult, setReplayResult] = useState<ReplayResult | null>(null);

  const historyQuery = useQuery({
    queryKey: ['history', world.saveId],
    queryFn: () => api.getHistory(world.saveId)
  });

  const exportMutation = useMutation({
    mutationFn: () => api.exportSave(world.saveId),
    onSuccess: (result) => {
      setExportToken(result.token);
      setMessage(`恢复码有效至 ${new Date(result.expiresAt).toLocaleDateString('zh-CN')}`);
    },
    onError: (error) => setMessage((error as ApiError).payload?.message ?? '导出失败')
  });

  const replayMutation = useMutation({
    mutationFn: () => api.replay(world.saveId),
    onSuccess: (result) => {
      setReplayResult(result);
      setMessage('');
    },
    onError: (error) => setMessage((error as ApiError).payload?.message ?? '历史重放失败')
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteSave(world.saveId),
    onSuccess: () => {
      queryClient.clear();
      navigate('/');
    },
    onError: (error) => setMessage((error as ApiError).payload?.message ?? '删除失败')
  });

  return (
    <div className="document-page settings-page">
      <header className="document-heading">
        <div>
          <p className="eyebrow">FIELD ARCHIVE</p>
          <h1>档案设置</h1>
          <p>导出恢复码、创建新档案或永久删除当前生态记录。</p>
        </div>
      </header>

      <section className="settings-grid">
        <article className="settings-card">
          <span>01</span>
          <h2>导出存档</h2>
          <p>生成单次使用的恢复码。导入后，当前浏览器会话将接管该档案。</p>
          <button className="button button-secondary" type="button" disabled={exportMutation.isPending} onClick={() => exportMutation.mutate()}>
            生成恢复码
          </button>
          {exportToken && (
            <label className="token-box">
              <span>保存恢复码</span>
              <textarea readOnly value={exportToken} rows={4} onFocus={(event) => event.currentTarget.select()} />
            </label>
          )}
        </article>

        <article className="settings-card">
          <span>02</span>
          <h2>档案信息</h2>
          <dl className="settings-details">
            <div><dt>存档 ID</dt><dd>{world.saveId}</dd></div>
            <div><dt>当前进度</dt><dd>第 {world.year} 年 · 第 {world.day} 日</dd></div>
            <div><dt>状态版本</dt><dd>revision {world.revision}</dd></div>
            <div><dt>恢复功能</dt><dd>{world.restorationUnlocked ? '已解锁' : '年度报告后评估'}</dd></div>
          </dl>
        </article>

        <article className="settings-card">
          <span>03</span>
          <h2>历史操作重放</h2>
          <p>
            已记录 {historyQuery.data?.commands.length ?? 0} 条命令流水。重放会用相同种子在独立沙库中按序重建全部操作，
            逐表比对当前权威状态，用于确认历史可重放、修复收益未被重复加成。
          </p>
          <button
            className="button button-secondary"
            type="button"
            disabled={replayMutation.isPending || (historyQuery.data?.commands.length ?? 0) === 0}
            onClick={() => replayMutation.mutate()}
          >
            {replayMutation.isPending ? '正在重放…' : '重放并校验'}
          </button>
          {replayResult && (
            <dl className="settings-details">
              <div><dt>重放命令数</dt><dd>{replayResult.commandsReplayed}</dd></div>
              <div><dt>版本一致</dt><dd>{replayResult.revisionMatch ? '是' : '否'}</dd></div>
              <div><dt>季节一致</dt><dd>{replayResult.seasonMatch ? '是' : '否'}</dd></div>
              <div>
                <dt>状态一致</dt>
                <dd className={replayResult.match ? 'replay-ok' : 'replay-bad'}>
                  {replayResult.match ? '完全一致' : `存在分歧：${replayResult.firstDifference?.table ?? '未知'}`}
                </dd>
              </div>
            </dl>
          )}
        </article>

        <article className="settings-card danger-card">
          <span>04</span>
          <h2>删除档案</h2>
          <p>删除会永久移除观察笔记、生态历史、年度报告与恢复码，无法撤销。</p>
          <button
            className="button button-danger"
            type="button"
            disabled={deleteMutation.isPending}
            onClick={() => {
              if (window.confirm('确定永久删除当前观察档案吗？')) {
                deleteMutation.mutate();
              }
            }}
          >
            永久删除
          </button>
        </article>
      </section>
      {message && <p className="settings-message">{message}</p>}
    </div>
  );
}
