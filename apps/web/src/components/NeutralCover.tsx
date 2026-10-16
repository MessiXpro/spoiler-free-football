import { competitionName, teamName, type PublicMatch } from '@sff/core';

/** 我们自己的中性封面：只有对阵和赛事，没有比分、没有时长 */
export function NeutralCover({
  match,
  label = '点击播放',
}: {
  match: PublicMatch;
  label?: string;
}) {
  return (
    <svg
      className="neutral-cover"
      viewBox="0 0 320 180"
      role="img"
      aria-label={`${teamName(match.home)} vs ${teamName(match.away)}`}
    >
      <defs>
        <linearGradient id="cover-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1f3d2b" />
          <stop offset="1" stopColor="#0f1f16" />
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill="url(#cover-bg)" />
      <g stroke="#2f5a40" strokeWidth="2" fill="none">
        <rect x="12" y="12" width="296" height="156" rx="4" />
        <line x1="160" y1="12" x2="160" y2="168" />
        <circle cx="160" cy="90" r="26" />
      </g>
      <text x="160" y="42" textAnchor="middle" fill="#9fd3b0" fontSize="14">
        {competitionName(match.competition)}
      </text>
      <text x="160" y="96" textAnchor="middle" fill="#ffffff" fontSize="20" fontWeight="600">
        {teamName(match.home)} vs {teamName(match.away)}
      </text>
      <g transform="translate(160 132)">
        <circle r="16" fill="#ffffff" opacity="0.9" />
        <path d="M-5 -8 L9 0 L-5 8 Z" fill="#1f3d2b" />
      </g>
      <text x="160" y="164" textAnchor="middle" fill="#cfe9d8" fontSize="11">
        {label}
      </text>
    </svg>
  );
}
