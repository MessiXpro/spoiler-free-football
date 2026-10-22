import { useMemo, useState, type ReactNode } from 'react';
import { href } from '../lib/router.ts';
import {
  COMPETITIONS,
  COMPETITION_KIND_LABELS,
  competitionMode,
  decodeSyncCode,
  encodeSyncCode,
  syncLink,
  TEAM_GROUP_LABELS,
  TEAMS,
  type CompetitionMode,
  type TeamGroup,
  type UserState,
} from '@sff/core';
import { ConfirmDialog } from '../components/Dialog.tsx';
import { detectShield } from '../lib/bridge.ts';
import { actions, getState, importState, mergeState } from '../lib/store.ts';
import { pullFromServer, randomSyncKey, uploadToServer } from '../lib/sync-server.ts';

const GROUPS: TeamGroup[] = [
  'epl',
  'laliga',
  'national',
  'eng-other',
  'esp-other',
  'europe',
  'world-club',
];
const MODE_LABELS: Record<CompetitionMode, string> = {
  off: '不看',
  teams: '只看订阅球队',
  all: '全部比赛',
};

function TeamPicker({ state }: { state: UserState }) {
  const [query, setQuery] = useState('');
  const [openGroups, setOpenGroups] = useState<Set<TeamGroup>>(
    new Set(['epl', 'laliga', 'national']),
  );
  const q = query.trim().toLowerCase();
  return (
    <div className="settings-block">
      <h3>订阅的球队（{state.teams.length}）</h3>
      <input
        type="search"
        className="input"
        placeholder="搜索球队，例如 阿森纳 / Arsenal"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        data-testid="team-search"
      />
      {GROUPS.map((g) => {
        const teams = TEAMS.filter(
          (t) =>
            t.group === g &&
            (!q ||
              t.zh.toLowerCase().includes(q) ||
              t.en.toLowerCase().includes(q) ||
              (t.zhAliases ?? []).some((a) => a.includes(q))),
        );
        if (!teams.length) return null;
        const expanded = Boolean(q) || openGroups.has(g);
        const count = teams.filter((t) => state.teams.includes(t.id)).length;
        return (
          <details
            key={g}
            open={expanded}
            onToggle={(e) => {
              const isOpen = (e.target as HTMLDetailsElement).open;
              setOpenGroups((prev) => {
                const next = new Set(prev);
                if (isOpen) next.add(g);
                else next.delete(g);
                return next;
              });
            }}
          >
            <summary>
              {TEAM_GROUP_LABELS[g]}（已订阅 {count}）
            </summary>
            <div className="chips">
              {teams.map((t) => {
                const on = state.teams.includes(t.id);
                return (
                  <button
                    type="button"
                    key={t.id}
                    className={`chip${on ? ' chip-on' : ''}`}
                    aria-pressed={on}
                    data-testid={`team-${t.id}`}
                    onClick={() => actions.toggleTeam(t.id)}
                  >
                    {t.zh}
                  </button>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function CompetitionPicker({ state }: { state: UserState }) {
  const kinds = [...new Set(COMPETITIONS.map((c) => c.kind))];
  return (
    <div className="settings-block">
      <h3>赛事</h3>
      <p className="muted small">
        「只看订阅球队」= 只显示上面订阅的球队参加的场次；「全部比赛」= 这项赛事的每一场。
      </p>
      {kinds.map((kind) => (
        <div key={kind} className="comp-group">
          <h4>{COMPETITION_KIND_LABELS[kind]}</h4>
          {COMPETITIONS.filter((c) => c.kind === kind).map((c) => (
            <label key={c.id} className="comp-row">
              <span>{c.zh}</span>
              <select
                value={competitionMode(state, c.id)}
                data-testid={`comp-${c.id}`}
                onChange={(e) =>
                  actions.setCompetitionMode(c.id, e.target.value as CompetitionMode)
                }
              >
                {(Object.keys(MODE_LABELS) as CompetitionMode[]).map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}

function SyncCodePanel({ state }: { state: UserState }) {
  const [code, setCode] = useState('');
  const [input, setInput] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<UserState | null>(null);
  const link = code ? syncLink(window.location.href, code) : '';

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage('已复制');
    } catch {
      setMessage('复制失败，请手动全选复制');
    }
  };

  return (
    <div className="settings-block">
      <h3>同步码（换设备用）</h3>
      <p className="muted small">
        把订阅和「已看」记录导出成一段文字或链接，在另一台设备的「导入」里粘贴即可。不需要注册账号。
      </p>
      <button
        type="button"
        className="btn btn-primary"
        data-testid="export-code"
        onClick={async () => {
          setCode(await encodeSyncCode(getState()));
          setMessage('');
        }}
      >
        生成同步码
      </button>
      {code && (
        <div className="code-box">
          <textarea
            readOnly
            value={code}
            rows={3}
            data-testid="sync-code"
            onFocus={(e) => e.target.select()}
          />
          <div className="link-list">
            <button type="button" className="btn btn-small" onClick={() => void copy(code)}>
              复制同步码
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => void copy(link)}
              data-testid="copy-link"
            >
              复制同步链接
            </button>
          </div>
        </div>
      )}
      <h4>导入</h4>
      <textarea
        className="input"
        rows={3}
        placeholder="粘贴同步码或同步链接"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        data-testid="import-input"
      />
      <button
        type="button"
        className="btn"
        data-testid="import-button"
        onClick={async () => {
          try {
            setPending(await decodeSyncCode(input));
            setMessage('');
          } catch (err) {
            setMessage((err as Error).message);
          }
        }}
      >
        导入
      </button>
      {message && (
        <p className="muted" role="status" data-testid="sync-message">
          {message}
        </p>
      )}
      {pending && (
        <ImportConfirm
          incoming={pending}
          current={state}
          onDone={(ok) => {
            setPending(null);
            if (ok) {
              setInput('');
              setMessage('导入完成');
            }
          }}
        />
      )}
    </div>
  );
}

export function ImportConfirm({
  incoming,
  current,
  onDone,
}: {
  incoming: UserState;
  current: UserState;
  onDone: (ok: boolean) => void;
}) {
  const newWatched = Object.keys(incoming.watched).filter((id) => !current.watched[id]).length;
  return (
    <ConfirmDialog
      title="导入同步码？"
      confirmText="导入"
      onCancel={() => onDone(false)}
      onConfirm={() => {
        importState(incoming);
        onDone(true);
      }}
    >
      <ul className="plain-list">
        <li>订阅球队：{incoming.teams.length} 支</li>
        <li>赛事设置：{Object.keys(incoming.competitions).length} 项与默认不同</li>
        <li>
          已看记录：{Object.keys(incoming.watched).length} 场（其中 {newWatched} 场本机还没有）
        </li>
      </ul>
      <p className="muted small">已看记录会合并；订阅、赛事和设置改用同步码里的。</p>
    </ConfirmDialog>
  );
}

function SyncServerPanel({ state }: { state: UserState }) {
  const [endpoint, setEndpoint] = useState(state.settings.syncEndpoint ?? '');
  const [message, setMessage] = useState('');
  const key = state.settings.syncKey;
  const run = async (fn: () => Promise<string>) => {
    try {
      setMessage(await fn());
    } catch (err) {
      setMessage((err as Error).message);
    }
  };
  return (
    <details className="settings-block">
      <summary>
        <h3>同步服务器（可选，高级）</h3>
      </summary>
      <p className="muted small">
        如果你按 README 部署了 Cloudflare
        Worker，可以在这里填地址，在设备之间手动同步：「上传到服务器」会先合并服务器上已有的记录再上传，不会冲掉其他设备的已看记录；「从服务器合并」把服务器上的记录合并到本机。不填也完全不影响使用。
      </p>
      <input
        className="input"
        type="url"
        placeholder="https://你的-worker.workers.dev"
        value={endpoint}
        onChange={(e) => setEndpoint(e.target.value)}
      />
      <div className="link-list">
        <button
          type="button"
          className="btn btn-small"
          onClick={() =>
            void run(async () => {
              if (!/^https:\/\//.test(endpoint)) throw new Error('地址需要以 https:// 开头');
              actions.updateSettings({ syncEndpoint: endpoint, syncKey: key ?? randomSyncKey() });
              return '已保存。在其他设备导入同步码后，会使用同一个同步空间。';
            })
          }
        >
          保存
        </button>
        {state.settings.syncEndpoint && key && (
          <>
            <button
              type="button"
              className="btn btn-small"
              onClick={() =>
                void run(async () => {
                  await uploadToServer(state.settings.syncEndpoint!, key);
                  return '已合并并上传';
                })
              }
            >
              上传到服务器
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={() =>
                void run(async () => {
                  const remote = await pullFromServer(state.settings.syncEndpoint!, key);
                  if (!remote) return '服务器上还没有数据';
                  mergeState(remote);
                  return '已从服务器合并';
                })
              }
            >
              从服务器合并
            </button>
          </>
        )}
      </div>
      {message && <p className="muted">{message}</p>}
    </details>
  );
}

type Device = 'ios' | 'android' | 'desktop';

/** 按当前设备把最适合的装法排在最前面（手机用户不用先看「下载插件 zip」） */
export function detectDevice(ua = navigator.userAgent, touchMac = false): Device {
  if (/iPhone|iPad|iPod/.test(ua) || touchMac) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

function InstallGuide() {
  const device = useMemo(
    () =>
      detectDevice(
        navigator.userAgent,
        /Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1,
      ),
    [],
  );
  const items: Array<{ key: Device | 'firefox' | 'pwa'; for: Device[]; body: ReactNode }> = [
    {
      key: 'ios',
      for: ['ios'],
      body: (
        <>
          iPhone / iPad：在 App Store 装{' '}
          <a
            href="https://apps.apple.com/app/userscripts/id1463298887"
            target="_blank"
            rel="noreferrer"
          >
            Userscripts
          </a>
          （免费），在 Safari 的扩展设置里打开它，然后点{' '}
          <a href="./userscript/spoiler-free-football.user.js">用户脚本</a> 安装。
        </>
      ),
    },
    {
      key: 'android',
      for: ['android'],
      body: (
        <>
          Android（Via、X 浏览器、狐猴等支持脚本的浏览器）：安装{' '}
          <a href="./userscript/spoiler-free-football.user.js">用户脚本</a>；想在所有网站生效可以装{' '}
          <a href="./userscript/spoiler-free-football-global.user.js">全网版</a>。
        </>
      ),
    },
    {
      key: 'desktop',
      for: ['desktop'],
      body: (
        <>
          电脑（Chrome、Microsoft Edge）：下载{' '}
          <a href="./downloads/spoiler-free-football-chrome.zip">插件 zip</a>
          ，解压后在扩展程序页面打开「开发者模式」，点「加载已解压的扩展程序」。 不想装插件也可以用
          Tampermonkey / Violentmonkey 装{' '}
          <a href="./userscript/spoiler-free-football.user.js">用户脚本</a>。
        </>
      ),
    },
    {
      key: 'firefox',
      for: ['desktop'],
      body: (
        <>
          Firefox：下载 <a href="./downloads/spoiler-free-football-firefox.zip">Firefox 版 zip</a>
          ，在 about:debugging 里临时加载。
        </>
      ),
    },
    {
      key: 'pwa',
      for: ['ios', 'android', 'desktop'],
      body: <>把本页「添加到主屏幕」，用起来像 App。</>,
    },
  ];
  const ordered = [
    ...items.filter((i) => i.for.includes(device)),
    ...items.filter((i) => !i.for.includes(device)),
  ];
  return (
    <div className="settings-block" id="install-block" data-testid="install-block">
      <h3>安装插件/脚本</h3>
      <ul className="plain-list small">
        {ordered.map((i, idx) => (
          <li key={i.key} data-testid={`install-${i.key}`}>
            {idx === 0 ? <span className="tag">你的设备</span> : null} {i.body}
          </li>
        ))}
      </ul>
      <p className="muted small">每一步的详细说明见项目 README。</p>
    </div>
  );
}

export function SettingsView({ state }: { state: UserState }) {
  const [askReset, setAskReset] = useState(false);
  const shield = useMemo(detectShield, []);
  return (
    <section className="view settings" data-testid="view-settings">
      <div className="view-head">
        <h2>设置</h2>
        <p className="muted" data-testid="shield-status">
          防剧透插件/脚本：
          {shield === 'extension'
            ? '已检测到浏览器插件'
            : shield === 'userscript'
              ? '已检测到用户脚本'
              : '未检测到'}
        </p>
        <p className="quick-links">
          <button
            type="button"
            className="btn btn-small"
            data-testid="goto-install"
            onClick={() =>
              document.getElementById('install-block')?.scrollIntoView({ behavior: 'smooth' })
            }
          >
            安装插件/脚本 ↓
          </button>
          <a className="btn btn-small" href={href({ name: 'about' })}>
            去哪看：正版渠道、数据来源 →
          </a>
        </p>
      </div>
      <TeamPicker state={state} />
      <CompetitionPicker state={state} />
      <div className="settings-block">
        <h3>显示</h3>
        <label className="toggle">
          <input
            type="checkbox"
            checked={state.settings.lockKnockoutOpponents}
            onChange={(e) => actions.updateSettings({ lockKnockoutOpponents: e.target.checked })}
            data-testid="toggle-lock"
          />
          淘汰赛：上一轮订阅比赛没看完时，先藏起下一轮的对阵
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={state.settings.embedMask}
            onChange={(e) => actions.updateSettings({ embedMask: e.target.checked })}
          />
          页内播放时，用遮挡条盖住播放器底部的时长和进度条
        </label>
        <label className="toggle">
          「即将开始」显示
          <select
            data-testid="upcoming-days"
            value={state.settings.upcomingDays}
            onChange={(e) => actions.updateSettings({ upcomingDays: Number(e.target.value) })}
          >
            {[3, 7, 14, 30].map((d) => (
              <option key={d} value={d}>
                {d} 天
              </option>
            ))}
          </select>
        </label>
      </div>
      <SyncCodePanel state={state} />
      <SyncServerPanel state={state} />
      <InstallGuide />
      <div className="settings-block">
        <button type="button" className="btn btn-danger" onClick={() => setAskReset(true)}>
          清空本机数据
        </button>
      </div>
      {askReset && (
        <ConfirmDialog
          title="清空本机的订阅和已看记录？"
          danger
          confirmText="清空"
          onCancel={() => setAskReset(false)}
          onConfirm={() => {
            actions.reset();
            setAskReset(false);
          }}
        >
          <p>建议先生成同步码备份。</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
