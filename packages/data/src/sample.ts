import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFixtureFetcher, type Fetcher } from './http.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = join(here, '..', 'test', 'fixtures');
export const SAMPLE_DIR = join(here, '..', 'sample');

/**
 * 示例数据的"当前时间"：北京时间 2026-09-21（周一）09:00。
 * 这时"昨夜今晨"里有英超曼城、利物浦、曼联和西甲马德里德比，并且都有真实比分。
 */
export const SAMPLE_NOW = new Date('2026-09-21T01:00:00Z');

export const fixture = (path: string) => readFileSync(join(FIXTURES_DIR, path), 'utf8');

/** 把所有外部请求映射到保存下来的真实响应；没有样本的请求返回空结果 */
export function sampleFetcher(onRequest?: (url: string) => void): Fetcher {
  return createFixtureFetcher(
    [
      [
        'openfootball/football.json/master/2026-27/en.1.json',
        () => fixture('openfootball/en.1-2026-27.json'),
      ],
      [
        'openfootball/football.json/master/2026-27/es.1.json',
        () => fixture('openfootball/es.1-2026-27.json'),
      ],
      ['api.football-data.org/v4/matches', () => fixture('football-data/matches-2026-10-13.json')],
      ['thesportsdb.com', () => '{"events":null}'],
    ],
    onRequest,
  );
}

export const SAMPLE_ENV = { FOOTBALL_DATA_TOKEN: 'sample-token' };
