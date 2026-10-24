import { useState } from 'react';
import {
  beijingDate,
  isFixtureLocked,
  neutralTitle,
  programLockReasons,
  type Program,
  type ProgramEpisode,
  type PublicMatch,
  type UserState,
} from '@sff/core';
import { ConfirmDialog } from '../components/Dialog.tsx';
import { detectShield } from '../lib/bridge.ts';
import type { AppData } from '../lib/data.ts';
import { href } from '../lib/router.ts';
import { actions } from '../lib/store.ts';

const ACCESS: Record<string, string> = { free: '免费', vip: '会员', login: '需登录' };
const RISK: Record<Program['spoilerRisk'], string> = {
  high: '可能剧透',
  medium: '可能剧透',
  low: '基本不剧透',
};

function ProgramCard({
  program,
  episodes,
  reasons,
  all,
  state,
  now,
}: {
  program: Program;
  episodes: ProgramEpisode[];
  reasons: PublicMatch[];
  all: PublicMatch[];
  state: UserState;
  now: Date;
}) {
  const locked = reasons.length > 0;
  const [asking, setAsking] = useState(false);
  const [warnUrl, setWarnUrl] = useState<string | null>(null);
  const open = (url: string) =>
    detectShield() ? window.open(url, '_blank', 'noopener') : setWarnUrl(url);
  const recent = episodes.filter((e) => Date.parse(e.airTime) <= now.getTime()).slice(-2);
  const next = episodes.find((e) => Date.parse(e.airTime) > now.getTime());
  return (
    <article
      className={`program-card${locked ? ' is-locked' : ''}`}
      data-testid="program-card"
      data-program-id={program.id}
    >
      <header className="match-head">
        <span className="comp">{program.channel}</span>
        <span className={`tag ${program.spoilerRisk === 'low' ? '' : 'tag-warn'}`}>
          {RISK[program.spoilerRisk]}
        </span>
        {program.availability === 'ended' && <span className="tag">疑似停播</span>}
        {program.availability === 'limited' && <span className="tag">部分信息待核实</span>}
      </header>
      <h3 className="teams">{program.nameZh}</h3>
      {program.nameEn && <p className="muted small">{program.nameEn}</p>}
      <p className="kickoff">{program.schedule}</p>
      {locked ? (
        <div className="locked-note" data-testid="program-locked">
          <p>还有 {reasons.length} 场相关的比赛没看完，节目可能会讲到它们的结果，先折叠起来：</p>
          <ul className="reason-list">
            {reasons.slice(0, 5).map((m) => (
              <li key={m.id}>
                {isFixtureLocked(m, all, state, now) ? (
                  // 对阵被锁定的淘汰赛：不显示队名，也不给链接（比赛编号里有队名）
                  <span>{neutralTitle(m, { lockedTeams: true })}</span>
                ) : (
                  <a href={href({ name: 'match', id: m.id })}>{neutralTitle(m)}</a>
                )}
              </li>
            ))}
            {reasons.length > 5 && <li>……共 {reasons.length} 场</li>}
          </ul>
          {/* 占位卡点不进去：给一句固定的提示和去处（只要有被锁的就显示同一句话，不随谁晋级而变） */}
          {reasons.some((m) => isFixtureLocked(m, all, state, now)) && (
            <p className="muted small" data-testid="program-locked-hint">
              「对阵待揭晓」的比赛要先看完更早一轮才能揭晓，
              <a href={href({ name: 'unwatched' })}>去「还没看完」</a>
              从最早的一场看起。
            </p>
          )}
          <button
            type="button"
            className="btn btn-small"
            data-testid="unlock-program"
            onClick={() => setAsking(true)}
          >
            不管了，展开节目
          </button>
        </div>
      ) : (
        <div className="program-body">
          <p>{program.description}</p>
          {program.note && <p className="muted">{program.note}</p>}
          {(recent.length > 0 || next) && (
            <ul className="episodes">
              {recent.map((e) => (
                <li key={e.airTime}>
                  <button type="button" className="link-btn" onClick={() => open(e.url)}>
                    {e.label}
                  </button>
                </li>
              ))}
              {next && <li className="muted">下一期：{next.label}</li>}
            </ul>
          )}
          <div className="link-list">
            {program.platforms.map((p) => (
              <button
                type="button"
                key={p.url}
                className="link-chip"
                onClick={() => open(p.url)}
                data-testid="program-link"
              >
                <span className="link-kind">{p.kind === 'full' ? '完整节目' : '片段'}</span>
                <span className="link-label">{p.name}</span>
                <span className="tag">{ACCESS[p.access]}</span>
                {!p.verified && <span className="tag tag-warn">待核实</span>}
              </button>
            ))}
          </div>
        </div>
      )}
      {asking && (
        <ConfirmDialog
          title={`展开「${program.nameZh}」？`}
          confirmText="展开"
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            actions.unlock(`program:${program.id}:${beijingDate(now)}`);
            setAsking(false);
          }}
        >
          <p>今天之内不再折叠这个节目。</p>
        </ConfirmDialog>
      )}
      {warnUrl && (
        <ConfirmDialog
          title="还没有开启防剧透插件或脚本"
          confirmText="仍然打开"
          onCancel={() => setWarnUrl(null)}
          onConfirm={() => {
            window.open(warnUrl, '_blank', 'noopener');
            setWarnUrl(null);
          }}
        >
          <p>节目页面的单期标题和简介经常带比分，建议先安装插件或脚本。</p>
        </ConfirmDialog>
      )}
    </article>
  );
}

export function ProgramsView({ data, state, now }: { data: AppData; state: UserState; now: Date }) {
  const available = data.programs.filter((p) => p.availability !== 'unavailable-in-china');
  const unavailable = data.programs.filter((p) => p.availability === 'unavailable-in-china');
  return (
    <section className="view" data-testid="view-programs">
      <div className="view-head">
        <h2>足球节目</h2>
        <p className="muted">节目默认按「可能剧透」处理：相关比赛没看完之前先折叠。</p>
      </div>
      {data.programs.length === 0 && (
        <p className="empty" data-testid="programs-empty">
          节目信息没有加载出来（节目表是单独的文件，可能是网络问题）。刷新页面再试试。
        </p>
      )}
      <div className="match-grid">
        {available.map((p) => (
          <ProgramCard
            key={p.id}
            program={p}
            episodes={data.episodes.filter((e) => e.programId === p.id)}
            reasons={programLockReasons(p, data.matches, state, now)}
            all={data.matches}
            state={state}
            now={now}
          />
        ))}
      </div>
      {unavailable.length > 0 && (
        <>
          <h2 className="section-title">国内无正版渠道（仅作标注，不提供链接）</h2>
          <ul className="plain-list" data-testid="programs-unavailable">
            {unavailable.map((p) => (
              <li key={p.id}>
                <strong>{p.nameEn ?? p.nameZh}</strong>（{p.channel}）：{p.note}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
