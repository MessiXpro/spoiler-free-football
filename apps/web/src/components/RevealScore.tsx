import { useState } from 'react';
import { teamName, type PublicMatch, type ScoreRecord } from '@sff/core';
import { fetchScore } from '../lib/data.ts';
import { actions, cachedScore, cacheScore } from '../lib/store.ts';
import { ConfirmDialog } from './Dialog.tsx';

type Phase = 'idle' | 'asking' | 'loading' | 'shown' | 'missing' | 'error';

/**
 * "看完了，显示比分"：二次确认后才请求 scores/<id>.json，同时记为已看。
 * 比分不在页面初始数据里，所以在点击之前页面上不可能出现比分。
 */
export function RevealScore({ match, watched }: { match: PublicMatch; watched: boolean }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [score, setScore] = useState<ScoreRecord | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    setPhase('loading');
    // 用户已经确认"看完了"，先记为已看（即使比分加载失败）
    actions.markWatched(match.id);
    try {
      const s = cachedScore(match.id) ?? (await fetchScore(match.id));
      if (s) {
        cacheScore(s);
        setScore(s);
        setPhase('shown');
      } else {
        setPhase('missing');
      }
    } catch (err) {
      setError((err as Error).message);
      setPhase('error');
    }
  };

  if (phase === 'shown' && score) {
    return (
      <ScoreView
        match={match}
        score={score}
        onHide={() => {
          actions.unmarkWatched(match.id);
          setPhase('idle');
          setScore(null);
        }}
      />
    );
  }

  return (
    <div className="reveal">
      {phase === 'missing' && (
        <p className="muted" data-testid="score-missing">
          数据源还没有这场的比分，已帮你记为「已看」。稍后再来看看。
        </p>
      )}
      {phase === 'error' && <p className="error">比分加载失败：{error}</p>}
      {phase !== 'missing' && (
        <button
          type="button"
          className={watched ? 'btn' : 'btn btn-reveal'}
          data-testid="reveal-button"
          disabled={phase === 'loading'}
          onClick={() => (watched ? void load() : setPhase('asking'))}
        >
          {phase === 'loading' ? '加载中…' : watched ? '查看比分' : '看完了，显示比分'}
        </button>
      )}
      {phase === 'asking' && (
        <ConfirmDialog
          title="确定显示比分吗？"
          confirmText="显示比分"
          onCancel={() => setPhase('idle')}
          onConfirm={() => void load()}
        >
          <p>
            {teamName(match.home)} vs {teamName(match.away)}
          </p>
          <p>显示后这场会记为「已看」，并同步到插件/脚本。</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function ScoreView({
  match,
  score,
  onHide,
}: {
  match: PublicMatch;
  score: ScoreRecord;
  onHide: () => void;
}) {
  return (
    <div className="score" data-testid="score-display">
      <div className="score-main">
        <span className="score-team">{teamName(match.home)}</span>
        <span className="score-num">
          {score.home} - {score.away}
        </span>
        <span className="score-team">{teamName(match.away)}</span>
      </div>
      <ul className="score-extra">
        {score.halfTime && (
          <li>
            半场 {score.halfTime[0]} - {score.halfTime[1]}
          </li>
        )}
        {score.extraTime && (
          <li>
            经过加时
            {score.regularTime
              ? `（90 分钟 ${score.regularTime[0]} - ${score.regularTime[1]}）`
              : ''}
          </li>
        )}
        {score.penalties && (
          <li>
            点球大战 {score.penalties[0]} - {score.penalties[1]}
          </li>
        )}
        {score.aggregate && (
          <li>
            两回合总比分 {score.aggregate[0]} - {score.aggregate[1]}
          </li>
        )}
        {score.note && <li>{score.note}</li>}
      </ul>
      <button type="button" className="btn btn-small" onClick={onHide}>
        藏起比分并标记为没看
      </button>
    </div>
  );
}
