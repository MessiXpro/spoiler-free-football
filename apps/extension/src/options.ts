import { HIDE_CATEGORIES, HIDE_CATEGORY_LABELS } from '@sff/core';
import { defaultRules } from '@sff/core/dom';
import { ext, loadSettings, saveSettings } from './api.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const DAYS = ['日', '一', '二', '三', '四', '五', '六'];

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
          (v: boolean) =>
            saveSettings({ prefs: { ...s.prefs, hide: { ...s.prefs.hide, [c]: v } } }),
        ] as [string, boolean, (v: boolean) => Promise<unknown>],
    ),
    [
      '封面图（换成中性占位图）',
      s.prefs.covers,
      (v) => saveSettings({ prefs: { ...s.prefs, covers: v } }),
    ],
    ['标签页标题', s.prefs.title, (v) => saveSettings({ prefs: { ...s.prefs, title: v } })],
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
    await saveSettings({ global: { ...s.global, enabled: ge.checked } });
    $('global-msg').textContent = ge.checked ? '已开启。' : '已关闭。';
    void render();
  };
  const start = $<HTMLInputElement>('global-start');
  const end = $<HTMLInputElement>('global-end');
  start.value = s.global.start;
  end.value = s.global.end;
  start.onchange = () => void saveSettings({ global: { ...s.global, start: start.value } });
  end.onchange = () => void saveSettings({ global: { ...s.global, end: end.value } });
  const days = $('global-days');
  days.innerHTML = '';
  DAYS.forEach((d, i) => {
    const l = document.createElement('label');
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = s.global.days.includes(i);
    c.onchange = () =>
      void saveSettings({
        global: {
          ...s.global,
          days: c.checked ? [...s.global.days, i] : s.global.days.filter((x) => x !== i),
        },
      }).then(render);
    l.append(c, document.createTextNode(`周${d}`));
    days.append(l);
  });

  const rules = s.rules ?? defaultRules();
  $('rules-info').textContent = `当前规则版本 ${rules.version}，覆盖 ${rules.sites.length} 个站点${
    s.rulesCheckedAt ? `；上次检查 ${new Date(s.rulesCheckedAt).toLocaleString('zh-CN')}` : ''
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
      void saveSettings({ disabledHosts: s.disabledHosts.filter((x) => x !== h) }).then(render);
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
    void saveSettings({ dataBase: v.endsWith('data/') ? v : `${v}data/` }).then(render);
  };
}

void render();
