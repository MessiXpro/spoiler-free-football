import { useEffect, useState } from 'react';
import { COMPETITIONS, decodeSyncCode, type UserState } from '@sff/core';
import type { AppData } from '../lib/data.ts';
import { href } from '../lib/router.ts';
import { ImportConfirm } from './SettingsView.tsx';

const CONFIDENCE: Record<string, string> = {
  high: '已核实',
  medium: '较可靠',
  low: '待核实',
  unverified: '待核实',
};

export function AboutView({ data }: { data: AppData }) {
  const b = data.broadcast;
  return (
    <section className="view" data-testid="view-about">
      <div className="view-head">
        <h2>去哪看（中国大陆正版渠道）</h2>
        <p className="muted">
          只链接正版/官方平台，本站不托管也不转播任何视频。
          {b ? `版权信息查证于 ${b.checkedAt}。` : ''}
        </p>
      </div>
      {b && (
        <div className="table-wrap">
          <table className="rights">
            <thead>
              <tr>
                <th>赛事</th>
                <th>平台</th>
                <th>可信度</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {COMPETITIONS.filter((c) => b.competitions[c.id]).flatMap((c) =>
                b.competitions[c.id]!.rights.map((r, i) => (
                  <tr key={`${c.id}-${i}`}>
                    <td>{i === 0 ? c.zh : ''}</td>
                    <td>{b.platforms[r.platform]?.name ?? r.platform}</td>
                    <td className={r.confidence === 'high' ? '' : 'warn'}>
                      {CONFIDENCE[r.confidence] ?? r.confidence}
                    </td>
                    <td className="small">{r.note}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
      {data.meta && (
        <div className="settings-block">
          <h3>数据来源</h3>
          <p className="muted small">
            数据生成时间：
            {new Date(data.meta.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
          </p>
          <ul className="plain-list">
            {data.meta.sources.map((s) => (
              <li key={s.id}>
                {s.ok ? '✓' : '·'} {s.name}：{s.count} 场{s.note ? `（${s.note}）` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function ImportView({ code, state }: { code: string; state: UserState }) {
  const [incoming, setIncoming] = useState<UserState | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => {
    decodeSyncCode(code)
      .then(setIncoming)
      .catch((err: Error) => setError(err.message));
  }, [code]);
  return (
    <section className="view" data-testid="view-import">
      <h2>导入同步码</h2>
      {error && <p className="error">{error}</p>}
      {done && (
        <p data-testid="import-done">
          导入完成。<a href={href({ name: 'today', offset: 0 })}>去看昨夜今晨</a>
        </p>
      )}
      {incoming && !done && (
        <ImportConfirm
          incoming={incoming}
          current={state}
          onDone={(ok) => {
            setIncoming(null);
            setDone(ok);
            if (!ok) window.location.hash = '#/settings';
          }}
        />
      )}
    </section>
  );
}
