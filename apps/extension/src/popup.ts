import { fetchScoreFrom, hostMatches } from '@sff/core/dom';
import {
  DEFAULT_WEB_URL,
  ext,
  loadSettings,
  saveSettings,
  type TabMessage,
  type TabStatus,
} from './api.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  // 测试时可以用 ?tab=<id> 指定标签页
  const forced = Number(new URLSearchParams(location.search).get('tab'));
  if (forced) return ext.tabs.get(forced);
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function send(tabId: number, msg: TabMessage): Promise<TabStatus | null> {
  try {
    return (await ext.tabs.sendMessage(tabId, msg)) as TabStatus;
  } catch {
    return null;
  }
}

function renderStatus(status: TabStatus | null, host: string) {
  const el = $('site-status');
  const pause = $<HTMLButtonElement>('pause');
  const resume = $<HTMLButtonElement>('resume');
  if (!status) {
    el.textContent = host ? `${host}：此页面没有启用防剧透` : '此页面没有启用防剧透';
    pause.hidden = true;
    resume.hidden = true;
    return;
  }
  if (!status.active) {
    el.textContent = `${status.site ?? host}：${status.reason ?? '未启用'}`;
    pause.hidden = true;
    resume.hidden = true;
    return;
  }
  const where = status.site ?? `${host}（全网模式）`;
  const kind = status.football ? '足球页面' : '普通页面';
  el.textContent = status.paused
    ? `${where}：已临时显示全部内容`
    : `${where}：${kind}，已遮挡 ${status.texts} 处文字、${status.blocks} 个比分块`;
  pause.hidden = status.paused;
  resume.hidden = !status.paused;
}

async function main() {
  const settings = await loadSettings();
  const tab = await activeTab();
  const tabId = tab?.id;
  let host = '';
  try {
    host = tab?.url ? new URL(tab.url).hostname : '';
  } catch {
    host = '';
  }

  const enabled = $<HTMLInputElement>('enabled');
  enabled.checked = settings.enabled;
  enabled.addEventListener('change', () => void saveSettings({ enabled: enabled.checked }));

  const status = tabId !== undefined ? await send(tabId, { type: 'status' }) : null;
  renderStatus(status, host);

  $('pause').addEventListener('click', async () => {
    if (tabId === undefined) return;
    renderStatus(await send(tabId, { type: 'pause', ms: 5 * 60 * 1000 }), host);
  });
  $('resume').addEventListener('click', async () => {
    if (tabId === undefined) return;
    renderStatus(await send(tabId, { type: 'resume' }), host);
  });

  const toggleSite = $<HTMLButtonElement>('toggle-site');
  const disabled = settings.disabledHosts.some((h) => host && hostMatches(host, h));
  toggleSite.textContent = disabled ? '在此站点启用' : '在此站点停用';
  toggleSite.hidden = !host;
  toggleSite.addEventListener('click', async () => {
    const s = await loadSettings();
    const list = disabled
      ? s.disabledHosts.filter((h) => !hostMatches(host, h))
      : [...s.disabledHosts, host];
    await saveSettings({ disabledHosts: list });
    window.close();
  });

  // 从网页跳转过来的比赛：可以在这里直接显示比分
  const match =
    status?.currentMatch ??
    (settings.currentMatch && host && hostMatches(host, settings.currentMatch.host)
      ? settings.currentMatch
      : null);
  if (match) {
    $('match-card').hidden = false;
    $('match-title').textContent = match.title;
    const reveal = $<HTMLButtonElement>('reveal');
    const confirmRow = $('reveal-confirm');
    if (settings.watched[match.id]) reveal.textContent = '查看比分';
    reveal.addEventListener('click', () => {
      if (settings.watched[match.id]) void showScore();
      else {
        reveal.hidden = true;
        confirmRow.hidden = false;
      }
    });
    $('reveal-no').addEventListener('click', () => {
      reveal.hidden = false;
      confirmRow.hidden = true;
    });
    $('reveal-yes').addEventListener('click', () => void showScore());
    const showScore = async () => {
      confirmRow.hidden = true;
      reveal.hidden = true;
      const out = $('match-score');
      out.textContent = '加载中…';
      const s = await loadSettings();
      await saveSettings({ watched: { ...s.watched, [match.id]: Math.floor(Date.now() / 1000) } });
      try {
        const score = await fetchScoreFrom(s.dataBase, match.id);
        out.textContent = score
          ? `${match.home.name} ${score.home} - ${score.away} ${match.away.name}${
              Array.isArray(score.penalties)
                ? `（点球 ${score.penalties[0]} - ${score.penalties[1]}）`
                : ''
            }${score.extraTime ? '（经过加时）' : ''}`
          : '数据源还没有这场的比分，已记为已看';
      } catch (err) {
        out.textContent = `比分加载失败：${(err as Error).message}`;
      }
    };
  }

  $('open-web').addEventListener('click', (e) => {
    e.preventDefault();
    const base = settings.dataBase.replace(/data\/?$/, '');
    void ext.tabs.create({ url: base || DEFAULT_WEB_URL });
  });
}

void main();
