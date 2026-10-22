import { currentMatchFor, fetchScoreFrom, hostDisabledBy } from '@sff/core/dom';
import {
  DEFAULT_WEB_URL,
  ext,
  loadSettings,
  saveSettings,
  WEB_MATCHES,
  type TabMessage,
  type TabStatus,
} from './api.ts';
import { isWebAppUrl } from './web-match.ts';

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

  // 防剧透网页本身不需要遮挡（用户点「显示比分」后比分要能看到），弹窗里说明一下就好
  const isWebApp = Boolean(tab?.url) && isWebAppUrl(tab!.url!, WEB_MATCHES);
  const status = tabId !== undefined && !isWebApp ? await send(tabId, { type: 'status' }) : null;
  if (isWebApp) {
    $('site-status').textContent = '这是防剧透看球网页本身，不需要遮挡';
    $<HTMLButtonElement>('pause').hidden = true;
    $<HTMLButtonElement>('resume').hidden = true;
  } else {
    renderStatus(status, host);
  }

  $('pause').addEventListener('click', async () => {
    if (tabId === undefined) return;
    renderStatus(await send(tabId, { type: 'pause', ms: 5 * 60 * 1000 }), host);
  });
  $('resume').addEventListener('click', async () => {
    if (tabId === undefined) return;
    renderStatus(await send(tabId, { type: 'resume' }), host);
  });

  const toggleSite = $<HTMLButtonElement>('toggle-site');
  const disabled = Boolean(host) && settings.disabledHosts.some((h) => hostDisabledBy(host, h));
  toggleSite.textContent = disabled ? '在此站点启用' : '在此站点停用';
  toggleSite.hidden = !host || isWebApp;
  toggleSite.addEventListener('click', async () => {
    const s = await loadSettings();
    const list = disabled
      ? s.disabledHosts.filter((h) => !hostDisabledBy(host, h))
      : [...s.disabledHosts, host];
    await saveSettings({ disabledHosts: list });
    window.close();
  });

  // 从网页跳转过来的比赛：可以在这里直接显示比分（和内容脚本一样，只认同平台、6 小时内的）
  const match = status?.currentMatch ?? (host ? currentMatchFor(settings, host) : null);
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
        out.textContent = `比分加载失败：${(err as Error).message}（已记为已看，可以再试一次）`;
        reveal.textContent = '再试一次';
        reveal.hidden = false;
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
