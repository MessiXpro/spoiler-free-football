// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, removeChromeMock } from './chrome-mock.ts';

const html = readFileSync(join(import.meta.dirname, '..', 'static', 'options.html'), 'utf8');

async function openOptions() {
  vi.resetModules();
  const chromeMock = installChromeMock();
  document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/
    .exec(html)![1]!
    .replace(/<script[\s\S]*?<\/script>/g, '');
  await import('../src/options.ts');
  const start = document.getElementById('global-start') as HTMLInputElement;
  await vi.waitFor(() => expect(start.value).toBe('06:00'));
  return chromeMock;
}

const change = (el: HTMLInputElement, apply: (el: HTMLInputElement) => void) => {
  apply(el);
  el.dispatchEvent(new Event('change'));
};

afterEach(() => removeChromeMock());

describe('设置页：全网防剧透时段', () => {
  it('先改开始时间、再改结束时间、勾选星期、开启：之前改的值都保留', async () => {
    const { store } = await openOptions();
    const stored = () =>
      (
        store.settings as {
          global: { enabled: boolean; start: string; end: string; days: number[] };
        }
      ).global;
    const start = document.getElementById('global-start') as HTMLInputElement;
    const end = document.getElementById('global-end') as HTMLInputElement;

    change(start, (el) => (el.value = '22:00'));
    await vi.waitFor(() => expect(stored().start).toBe('22:00'));
    change(end, (el) => (el.value = '08:00'));
    await vi.waitFor(() => expect(stored().end).toBe('08:00'));
    expect(stored().start).toBe('22:00');

    const sunday = document.querySelector('#global-days input') as HTMLInputElement;
    change(sunday, (el) => (el.checked = false));
    await vi.waitFor(() => expect(stored().days).toEqual([1, 2, 3, 4, 5, 6]));
    expect(stored()).toMatchObject({ start: '22:00', end: '08:00' });

    change(
      document.getElementById('global-enabled') as HTMLInputElement,
      (el) => (el.checked = true),
    );
    await vi.waitFor(() => expect(stored().enabled).toBe(true));
    expect(stored()).toMatchObject({ start: '22:00', end: '08:00', days: [1, 2, 3, 4, 5, 6] });
  });

  it('连续快速修改也不会互相覆盖', async () => {
    const { store } = await openOptions();
    const start = document.getElementById('global-start') as HTMLInputElement;
    const end = document.getElementById('global-end') as HTMLInputElement;
    change(start, (el) => (el.value = '21:00'));
    change(end, (el) => (el.value = '09:00'));
    await vi.waitFor(() =>
      expect((store.settings as { global: object } | undefined)?.global).toMatchObject({
        start: '21:00',
        end: '09:00',
      }),
    );
  });
});
