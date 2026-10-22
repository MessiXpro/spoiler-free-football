import { useEffect, useState } from 'react';
import { COMPETITIONS, decodeSyncCode, type UserState } from '@sff/core';
import type { AppData } from '../lib/data.ts';
import { href } from '../lib/router.ts';
import { ImportConfirm } from './SettingsView.tsx';

/** 部署时由工作流传入（GitHub 仓库地址），本地开发时为空 */
const REPO_URL = (import.meta.env.VITE_SFF_REPO_URL as string | undefined) || '';

/** 数据来源的官网（署名/说明用） */
const SOURCE_URLS: Record<string, string> = {
  openfootball: 'https://github.com/openfootball/football.json',
  'football-data': 'https://www.football-data.org/',
  thesportsdb: 'https://www.thesportsdb.com/',
  'api-football': 'https://www.api-football.com/',
};

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
                {s.ok ? '✓' : '·'}{' '}
                {SOURCE_URLS[s.id] ? (
                  <a href={SOURCE_URLS[s.id]} target="_blank" rel="noreferrer">
                    {s.name}
                  </a>
                ) : (
                  s.name
                )}
                ：{s.count} 场{s.note ? `（${s.note}）` : ''}
              </li>
            ))}
          </ul>
          {REPO_URL ? (
            <p className="muted small">
              <a href={REPO_URL} target="_blank" rel="noreferrer">
                项目主页（GitHub）
              </a>
              {' · '}
              <a href={`${REPO_URL}/actions`} target="_blank" rel="noreferrer">
                数据更新记录（Actions）
              </a>
            </p>
          ) : null}
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
      {error && (
        <>
          <p className="error">{error}</p>
          <p className="muted small">
            同步码在另一台设备的「设置 → 同步码（换设备用）」里生成，复制整段再打开；也可以直接去
            <a href={href({ name: 'settings' })}>设置</a>。
          </p>
        </>
      )}
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
