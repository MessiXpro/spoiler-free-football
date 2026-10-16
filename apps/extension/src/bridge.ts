import { ext, loadSettings, onSettingsChanged, saveSettings } from './api.ts';

/**
 * 只在防剧透网页上运行：
 * - 给 <html> 打上 data-sff-shield="extension"，网页据此知道插件已安装
 * - 接收网页的"即将去看哪一场"，存起来给平台页面和弹窗用
 * - 双向同步"已看"记录
 */
function mark() {
  if (!document.documentElement) return false;
  document.documentElement.dataset.sffShield = 'extension';
  return true;
}
if (!mark()) {
  new MutationObserver((_, o) => {
    if (mark()) o.disconnect();
  }).observe(document, { childList: true });
}

const target = location.origin === 'null' ? '*' : location.origin;
const postWatched = (watched: Record<string, number>) =>
  window.postMessage({ source: 'sff-shield', type: 'watched', watched }, target);

interface WebMessage {
  source?: string;
  type?: string;
  dataBase?: string;
  watched?: Record<string, number>;
  url?: string;
  liveMode?: boolean;
  match?: {
    id: string;
    title: string;
    competition: string;
    kickoff: string;
    home: { id: string; name: string };
    away: { id: string; name: string };
  };
}

function mergeWatched(a: Record<string, number>, b: Record<string, number> | undefined) {
  const out = { ...a };
  let changed = false;
  for (const [id, t] of Object.entries(b ?? {})) {
    if (typeof t === 'number' && !out[id]) {
      out[id] = t;
      changed = true;
    }
  }
  return { out, changed };
}

window.addEventListener('message', async (e: MessageEvent) => {
  if (e.source !== window) return;
  const data = e.data as WebMessage | null;
  if (data?.source !== 'sff-web') return;
  const settings = await loadSettings();
  if (data.type === 'hello') {
    const patch: Parameters<typeof saveSettings>[0] = {};
    if (
      typeof data.dataBase === 'string' &&
      /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(data.dataBase)
    ) {
      patch.dataBase = data.dataBase;
    }
    const { out, changed } = mergeWatched(settings.watched, data.watched);
    if (changed) patch.watched = out;
    if (Object.keys(patch).length) await saveSettings(patch);
    postWatched(out);
  } else if (data.type === 'state') {
    const { out, changed } = mergeWatched(settings.watched, data.watched);
    if (changed) await saveSettings({ watched: out });
  } else if (data.type === 'open-match' && data.match && data.url) {
    let host = '';
    try {
      host = new URL(data.url).hostname;
    } catch {
      return;
    }
    await saveSettings({
      currentMatch: {
        ...data.match,
        url: data.url,
        host,
        at: Date.now(),
        liveMode: Boolean(data.liveMode),
      },
    });
  }
});

// 在插件弹窗里显示了比分 → 告诉网页
onSettingsChanged((s) => postWatched(s.watched));
void ext;
