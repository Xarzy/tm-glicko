import { Resvg } from '@resvg/resvg-js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlayerRankTierInfo, RankDivisionRatingRange } from './rankService';

export interface PlayerCardData {
  username: string;
  rank: number;
  total: number;
  rating: number;
  latestChange: string;
  peakRating: number;
  tier: PlayerRankTierInfo;
  divisionRanges: RankDivisionRatingRange[];
}

export function getPlayerCardSegmentProgress(
  rating: number,
  rankCode: string,
  division: number,
  range: RankDivisionRatingRange,
): number {
  if (rankCode === 'trackmaster') {
    if (rating >= range.endRating) return 1;
    if (rating <= range.startRating) return 0;
    const ratingRange = range.endRating - range.startRating;
    return ratingRange > 0 ? (rating - range.startRating) / ratingRange : 0;
  }

  if (range.division < division) return 1;
  if (range.division > division) return 0;

  const ratingRange = range.endRating - range.startRating;
  return ratingRange > 0
    ? Math.max(0, Math.min(1, (rating - range.startRating) / ratingRange))
    : 1;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, character => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&apos;',
  })[character]!);
}

function formatRating(rating: number): string {
  return Math.round(rating).toLocaleString('en-US');
}

export function renderPlayerCard(data: PlayerCardData): Buffer {
  const width = 1000;
  const height = 330;
  const outputScale = 1.6;
  const color = `#${data.tier.rank.tierColor.toString(16).padStart(6, '0')}`;
  const username = escapeXml(data.username);
  const rankIconPath = join(process.cwd(), 'images', data.tier.rank.iconFile);
  const rankIcon = existsSync(rankIconPath)
    ? `data:image/png;base64,${readFileSync(rankIconPath).toString('base64')}`
    : null;

  const segmentStartX = 48;
  const segmentGap = 12;
  const segmentWidth = (width - segmentStartX * 2 - segmentGap * 3) / 4;
  const segmentY = 173;
  const segmentHeight = 24;
  const renderSegment = (
    range: RankDivisionRatingRange,
    x: number,
    width: number,
    progress: number,
    startLabel: string,
    endLabel: string,
  ) => {
    const fillWidth = Math.max(0, width * progress);
    return `
      <rect x="${x}" y="${segmentY}" width="${width}" height="${segmentHeight}" rx="8" fill="#282e39" />
      ${fillWidth > 0
        ? `<rect x="${x}" y="${segmentY}" width="${fillWidth}" height="${segmentHeight}" rx="8" fill="${color}" />`
        : ''}
      <text x="${x}" y="${segmentY + 48}" fill="#9aa4b2" font-size="13" font-family="Arial" font-weight="700">${startLabel}</text>
      ${endLabel
        ? `<text x="${x + width}" y="${segmentY + 48}" fill="#9aa4b2" font-size="13" font-family="Arial" font-weight="700" text-anchor="end">${endLabel}</text>`
        : ''}
      <text x="${x}" y="${segmentY + 68}" fill="#727d8c" font-size="12" font-family="monospace">${formatRating(range.startRating)}–${formatRating(range.endRating)}</text>
    `;
  };
  const segments = data.tier.rank.code === 'trackmaster'
    ? (() => {
      const firstRange = data.divisionRanges[0];
      const lastRange = data.divisionRanges[data.divisionRanges.length - 1];
      if (!firstRange || !lastRange) return '';
      const range = {
        division: 1,
        startRating: firstRange.startRating,
        endRating: lastRange.endRating,
      };
      return renderSegment(
        range,
        segmentStartX,
        width - segmentStartX * 2,
        getPlayerCardSegmentProgress(data.rating, 'trackmaster', 1, range),
        'TM ENTRY',
        '#1',
      );
    })()
    : data.divisionRanges.map((range, index) => {
      const x = segmentStartX + index * (segmentWidth + segmentGap);
      const progress = getPlayerCardSegmentProgress(
        data.rating,
        data.tier.rank.code,
        data.tier.division,
        range,
      );
      return renderSegment(
        range,
        x,
        segmentWidth,
        progress,
        `DIV ${['I', 'II', 'III', 'IV'][index]}`,
        '',
      );
    }).join('');

  const progressLabel = data.tier.rank.code === 'trackmaster'
    ? 'Trackmaster progress · entry rating to #1'
    : `${data.tier.rank.shortName} division progress`;
  const iconMarkup = rankIcon
    ? `<image x="866" y="35" width="76" height="76" href="${rankIcon}" preserveAspectRatio="xMidYMid meet" />`
    : '';
  const topRightText = data.tier.rank.code === 'trackmaster' && data.rank === 1
    ? '#1'
    : `#${data.rank} / ${data.total}`;
  const latestChangeColor = data.latestChange.startsWith('-') ? '#ff6b6b' : '#55d6a2';

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width * outputScale}" height="${height * outputScale}" viewBox="0 0 ${width} ${height}">
      <rect width="${width}" height="${height}" rx="28" fill="#141821" />
      <path d="M28 0 H14 Q0 0 0 14 V316 Q0 330 14 330 H28 Z" fill="${color}" />
      <text x="48" y="66" fill="#f4f6f8" font-size="34" font-family="Arial" font-weight="700">${username}</text>
      <text x="48" y="105" fill="#c5ccd5" font-size="18" font-family="Arial">${escapeXml(data.tier.fullName)}</text>
      <text x="48" y="143" fill="#f4f6f8" font-size="25" font-family="Arial" font-weight="700">${formatRating(data.rating)}</text>
      <text x="173" y="143" fill="#838e9e" font-size="14" font-family="Arial">RATING</text>
      <text x="810" y="85" fill="#f4f6f8" font-size="20" font-family="Arial" font-weight="700" text-anchor="end">${topRightText}</text>
      ${iconMarkup}
      <text x="48" y="164" fill="#747f8e" font-size="12" font-family="Arial" font-weight="700">${progressLabel}</text>
      ${segments}
      <text x="48" y="280" fill="#8f9aaa" font-size="14" font-family="Arial">LATEST CHANGE</text>
      <text x="48" y="301" fill="${latestChangeColor}" font-size="17" font-family="Arial" font-weight="700">${escapeXml(data.latestChange)}</text>
      <text x="952" y="280" fill="#8f9aaa" font-size="14" font-family="Arial" text-anchor="end">PEAK RATING</text>
      <text x="952" y="301" fill="#f4f6f8" font-size="17" font-family="Arial" font-weight="700" text-anchor="end">${formatRating(data.peakRating)}</text>
    </svg>
  `.trim();

  const png = new Resvg(svg, {
    font: { loadSystemFonts: true, defaultFontFamily: 'Cascadia Code' },
    shapeRendering: 2,
    textRendering: 1,
  }).render().asPng();
  const buffer = Buffer.alloc(png.byteLength);
  buffer.set(png);
  return buffer;
}
