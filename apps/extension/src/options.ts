import { HIDE_CATEGORIES, HIDE_CATEGORY_LABELS } from '@sff/core';
import { defaultRules, type ShieldSettings } from '@sff/core/dom';
import { ext, loadSettings, saveSettings } from './api.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const DAYS = ['日', '一', '二', '三', '四', '五', '六'];
/** <input type="time"> 的值是否完整（HH:MM），和用户脚本面板的检查一致 */
const isTimeValue = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

declare const __SFF_SITE_MATCHES__: string[];
/** 构建时注入：这个版本的插件有权限的站点（manifest 的 content_scripts.matches / host_permissions） */
const SITE_MATCHES: string[] | null =
  typeof __SFF_SITE_MATCHES__ !== 'undefined' ? __SFF_SITE_MATCHES__ : null;

/**
 * 每次修改都基于存储里最新的设置合并（并且一个接一个写）：render() 拿到的 s 只是打开页面时的快照，
 * 直接展开它会把刚改过的字段改回去（例如先改开始时间、再改结束时间）。
 */
let queue: Promise<unknown> = Promise.resolve();
function update(patch: (cur: ShieldSettings) => Partial<ShieldSettings>): Promise<ShieldSettings> {
  const next = queue.then(async () => saveSettings(patch(await loadSettings())));
  queue = next.catch(() => {});
  return next;
}
const saveGlobal = (p: Partial<ShieldSettings['global']>) =>
  update((cur) => ({ global: { ...cur.global, ...p } }));
const savePrefs = (p: (prefs: ShieldSettings['prefs']) => Partial<ShieldSettings['prefs']>) =>
  update((cur) => ({ prefs: { ...cur.prefs, ...p(cur.prefs) } }));

async function render() {
  const s = await loadSettings();

  const cats = $('categories');
  cats.innerHTML = '';
  const items: Array<[string, boolean, (v: boolean) => Promise<unknown>]> = [
    ...HIDE_CATEGORIES.map(
      (c) =>
        [
          HIDE_CATEGORY_LABELS[c],
          s.prefs.hide[c],
          (v: boolean) => savePrefs((p) => ({ hide: { ...p.hide, [c]: v } })),
        ] as [string, boolean, (v: boolean) => Promise<unknown>],
    ),
    ['封面图（换成中性占位图）', s.prefs.covers, (v) => savePrefs(() => ({ covers: v }))],
    ['标签页标题', s.prefs.title, (v) => savePrefs(() => ({ title: v }))],
  ];
  for (const [label, checked, onChange] of items) {
    const row = document.createElement('label');
    row.className = 'row gap';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => void onChange(input.checked).then(render));
    row.append(input, document.createTextNode(label));
    cats.append(row);
  }

  const ge = $<HTMLInputElement>('global-enabled');
  ge.checked = s.global.enabled;
  ge.onchange = async () => {
    if (ge.checked) {
      // 必须在用户点击时申请权限
      const ok = await ext.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
      if (!ok) {
        ge.checked = false;
        $('global-msg').textContent = '没有获得权限，全网模式未开启。';
        return;
      }
    }
    await saveGlobal({ enabled: ge.checked });
    $('global-msg').textContent = ge.checked ? '已开启。' : '已关闭。';
    void render();
  };
  const start = $<HTMLInputElement>('global-start');
  const end = $<HTMLInputElement>('global-end');
  start.value = s.global.start;
  end.value = s.global.end;
  // <input type="time"> 清空后值是 ''，存进去会被当成 00:00（06:00 到 '' 变成遮到半夜）：没填完整就恢复原值
  const onTime = (el: HTMLInputElement, key: 'start' | 'end') => () => {
    if (isTimeValue(el.value)) {
      void saveGlobal({ [key]: el.value });
      return;
    }
    void queue.then(loadSettings).then((cur) => {
      el.value = cur.global[key];
      $('global-msg').textContent = '时间没有填完整，已恢复原来的值。';
    });
  };
  start.onchange = onTime(start, 'start');
  end.onchange = onTime(end, 'end');
  const days = $('global-days');
  days.innerHTML = '';
  DAYS.forEach((d, i) => {
    const l = document.createElement('label');
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = s.global.days.includes(i);
    c.onchange = () =>
      void update((cur) => ({
        global: {
          ...cur.global,
          days: c.checked
            ? [...new Set([...cur.global.days, i])].sort((a, b) => a - b)
            : cur.global.days.filter((x) => x !== i),
        },
      })).then(render);
    l.append(c, document.createTextNode(`周${d}`));
    days.append(l);
  });

  const rules = s.rules ?? defaultRules();
  // 下载来的规则里新增的站点（hosts）：这个版本的插件没有它们的权限、内容脚本不会注入，光改规则不起作用；
  // 开了全网防剧透的话，全网脚本会按站点规则处理它们
  const uncovered = SITE_MATCHES
    ? [...new Set(rules.sites.flatMap((site) => site.hosts))].filter(
        (h) => !SITE_MATCHES.includes(`*://*.${h}/*`),
      )
    : [];
  $('rules-info').textContent = `当前规则版本 ${rules.version}，覆盖 ${rules.sites.length} 个站点${
    s.rulesCheckedAt ? `；上次检查 ${new Date(s.rulesCheckedAt).toLocaleString('zh-CN')}` : ''
  }${
    uncovered.length && !s.global.enabled
      ? `；规则里新增了 ${uncovered.join('、')}：这个版本的插件没有这些站点的权限，需要重新安装新版插件，或开启上面的全网防剧透`
      : ''
  }`;
  $('update-rules').onclick = async () => {
    await ext.runtime.sendMessage({ type: 'update-rules' });
    void render();
  };
  const list = $('disabled-hosts');
  list.innerHTML = '';
  if (!s.disabledHosts.length) list.textContent = '（无）';
  for (const h of s.disabledHosts) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.textContent = '恢复';
    b.onclick = () =>
      void update((cur) => ({ disabledHosts: cur.disabledHosts.filter((x) => x !== h) })).then(
        render,
      );
    li.append(document.createTextNode(`${h} `), b);
    list.append(li);
  }

  const base = $<HTMLInputElement>('data-base');
  base.value = s.dataBase;
  $('save-base').onclick = () => {
    if (!/^https:\/\//.test(base.value)) {
      alert('地址需要以 https:// 开头');
      return;
    }
    const v = base.value.endsWith('/') ? base.value : `${base.value}/`;
    void update(() => ({ dataBase: v.endsWith('data/') ? v : `${v}data/` })).then(render);
  };
}

void render();
