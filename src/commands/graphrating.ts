import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AttachmentBuilder,
} from 'discord.js';
import { Resvg } from '@resvg/resvg-js';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findAccountIdsByUsernames } from '../services/accountLookup';
import { getRatingHistoryForAccounts } from '../db';
import { getRankThresholdBands, type RankThresholdBand } from '../services/rankService';

const IMAGES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../images');
const rankIconDataUriCache = new Map<string, string | null>();

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

function getRankIconDataUri(iconFile: string | undefined): string | null {
  if (!iconFile) return null;
  if (rankIconDataUriCache.has(iconFile)) {
    return rankIconDataUriCache.get(iconFile) ?? null;
  }

  const iconPath = join(IMAGES_DIR, iconFile);
  if (!existsSync(iconPath)) {
    rankIconDataUriCache.set(iconFile, null);
    return null;
  }

  // Browsers can load file:// images in raw SVG, but resvg on Windows cannot.
  // Embed a small rasterized PNG so the Discord attachment actually includes the icon.
  const sourceBytes = new Uint8Array(readFileSync(iconPath));
  const sourceUri = `data:image/png;base64,${bytesToBase64(sourceBytes)}`;
  const iconSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="48" height="48">
      <image href="${sourceUri}" xlink:href="${sourceUri}" width="48" height="48" preserveAspectRatio="xMidYMid meet" />
    </svg>
  `.trim();

  try {
    const raster = new Resvg(iconSvg, {
      fitTo: { mode: 'width', value: 48 },
      imageRendering: 0,
    }).render().asPng();
    const dataUri = `data:image/png;base64,${bytesToBase64(new Uint8Array(raster))}`;
    rankIconDataUriCache.set(iconFile, dataUri);
    return dataUri;
  } catch {
    rankIconDataUriCache.set(iconFile, sourceUri);
    return sourceUri;
  }
}

export const data = new SlashCommandBuilder()
  .setName('graphrating')
  .setDescription('Plots the Glicko-2 rating history for up to 20 Trackmania players.')
  .addStringOption(o =>
    o
      .setName('usernames')
      .setDescription('Comma-separated list of Trackmania usernames (max 20).')
      .setRequired(true)
  );

// Palette of vibrant colors matching the dark theme in the reference
const COLORS = [
  '#9d4edd', // Purple
  '#00f5d4', // Cyan
  '#ffd166', // Gold / Pale Yellow
  '#ff0054', // Neon Red / Pink
  '#3a86ff', // Bright Blue
  '#06d6a0', // Mint Green
  '#ffbe0b', // Amber
  '#fb5607', // Orange
  '#ff70a6', // Rose
  '#70d6ff', // Sky Blue
  '#e0aaff', // Lavender
  '#9ef01a', // Lime
  '#f72585', // Magenta
  '#4cc9f0', // Ice Blue
  '#b5179e', // Violet
  '#fee440', // Bright Yellow
  '#52b788', // Emerald
  '#ff99c8', // Soft Pink
  '#f15bb5', // Fuchsia
  '#ffffff', // White
];

interface PlayerData {
  username: string;
  accountId: string;
  color: string;
  points: { dateStr: string; time: number; rating: number }[];
}

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const rawInput = interaction.options.getString('usernames', true);
  const usernames = Array.from(
    new Set(
      rawInput
        .split(',')
        .map(u => u.trim())
        .filter(u => u.length > 0)
    )
  ).slice(0, 20);

  if (usernames.length === 0) {
    await interaction.editReply('Please specify at least one valid username.');
    return;
  }

  // 1. Resolve Account IDs
  const accountMap = await findAccountIdsByUsernames(usernames);
  const foundPlayers: { username: string; accountId: string }[] = [];
  const notFound: string[] = [];

  for (const name of usernames) {
    const id = accountMap.get(name.toLowerCase());
    if (id) {
      foundPlayers.push({ username: name, accountId: id });
    } else {
      notFound.push(name);
    }
  }

  if (foundPlayers.length === 0) {
    await interaction.editReply(
      `Could not find any Trackmania accounts for: **${usernames.join(', ')}**.`
    );
    return;
  }

  // 2. Fetch rating history for these accounts
  const accountIds = foundPlayers.map(p => p.accountId);
  const historyRows = await getRatingHistoryForAccounts(accountIds, 'qualifying');

  if (historyRows.length === 0) {
    await interaction.editReply(
      `No COTD rating history found for: ${foundPlayers.map(p => `**${p.username}**`).join(', ')}. Try running the recalculation or waiting for cups to be processed.`
    );
    return;
  }

  // Group history by player
  const playerSeries: PlayerData[] = [];
  let colorIdx = 0;

  for (const p of foundPlayers) {
    const playerRows = historyRows.filter(r => r.accountId === p.accountId);
    if (playerRows.length === 0) continue;

    const points = playerRows.map(r => ({
      dateStr: r.cotdDate,
      time: new Date(r.cotdDate).getTime(),
      rating: r.rating,
    }));

    // Ensure sorted by time
    points.sort((a, b) => a.time - b.time);

    playerSeries.push({
      username: p.username,
      accountId: p.accountId,
      color: COLORS[colorIdx % COLORS.length],
      points,
    });
    colorIdx++;
  }

  if (playerSeries.length === 0) {
    await interaction.editReply('None of the specified players have rating history data yet.');
    return;
  }

  // 3. Render SVG and rasterize to high-resolution PNG (2x supersampling for crisp text and lines)
  const bands = await getRankThresholdBands();
  const svg = renderRatingChartWithRankZones(playerSeries, bands);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 2400 },
    font: {
      loadSystemFonts: true,
      defaultFontFamily: 'Arial',
    },
    shapeRendering: 2, // geometricPrecision
    textRendering: 1,  // geometricPrecision
    imageRendering: 0, // optimizeQuality
  });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  const attachment = new AttachmentBuilder(pngBuffer, { name: 'rating-history.png' });

  let replyText = '';
  if (notFound.length > 0) {
    replyText = `*(Could not find: ${notFound.map(n => `\`${n}\``).join(', ')})*`;
  }

  await interaction.editReply({
    content: replyText || undefined,
    files: [attachment],
  });
}

function renderRatingChartWithRankZones(
  series: PlayerData[],
  bands: RankThresholdBand[],
): string {
  const width = 1300;
  const height = 800;
  const margin = { top: 60, right: 160, bottom: 90, left: 80 };

  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  // Global time domain
  let minTime = Infinity;
  let maxTime = -Infinity;
  let minRating = 1100;
  let maxRating = 1600;

  for (const s of series) {
    for (const pt of s.points) {
      if (pt.time < minTime) minTime = pt.time;
      if (pt.time > maxTime) maxTime = pt.time;
      if (pt.rating < minRating) minRating = pt.rating;
      if (pt.rating > maxRating) maxRating = pt.rating;
    }
  }

  // Round rating bounds to nice multiples of 100
  minRating = Math.max(0, Math.floor((minRating - 40) / 100) * 100);
  maxRating = Math.ceil((maxRating + 40) / 100) * 100;

  if (minTime === maxTime) {
    minTime -= 86400000 * 7;
    maxTime += 86400000 * 7;
  }

  const timeSpan = maxTime - minTime;
  const ratingSpan = maxRating - minRating;

  const getX = (t: number) => margin.left + ((t - minTime) / timeSpan) * plotW;
  const getY = (r: number) => margin.top + plotH - ((r - minRating) / ratingSpan) * plotH;

  // Rating grid lines (step of 100)
  let gridLinesSvg = '';
  let axisLabelsSvg = '';
  for (let r = minRating; r <= maxRating; r += 100) {
    const y = getY(r);
    gridLinesSvg += `
      <line x1="${margin.left}" y1="${y}" x2="${margin.left + plotW}" y2="${y}" stroke="#1f232b" stroke-dasharray="3,4" stroke-width="1" />
    `;
    axisLabelsSvg += `
      <text x="${margin.left - 12}" y="${y + 4}" fill="#717a8a" font-size="11" text-anchor="end" font-family="monospace">${r}</text>
    `;
  }

  // Time grid & tick marks (approx 8 evenly spaced dates)
  const numTimeTicks = 8;
  for (let i = 0; i <= numTimeTicks; i++) {
    const t = minTime + (timeSpan / numTimeTicks) * i;
    const x = getX(t);
    const dateStr = new Date(t).toISOString().slice(0, 10);
    gridLinesSvg += `
      <line x1="${x}" y1="${margin.top + plotH}" x2="${x}" y2="${margin.top + plotH + 6}" stroke="#333a45" stroke-width="1" />
    `;
    axisLabelsSvg += `
      <text x="${x}" y="${margin.top + plotH + 24}" fill="#717a8a" font-size="10" text-anchor="middle" font-family="monospace">${dateStr}</text>
    `;
  }

  // Rank zone backgrounds (behind grid/lines). Icons are embedded as data URIs
  // because resvg does not reliably load file:// images on Windows.
  const iconSize = 22;
  const visibleBands = (bands ?? [])
    .map((b) => {
      const bandMin = Math.max(minRating, b.minRating);
      const bandMax = Math.min(maxRating, b.maxRating);
      if (bandMax <= bandMin) return null;

      const yTop = getY(bandMax);
      const yBottom = getY(bandMin);
      const h = Math.max(0, yBottom - yTop);
      if (h < 1) return null;

      return { ...b, yTop, h };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null);

  const rankZonesSvg = visibleBands
    .map((b) => {
      const fill = b.rank.svgColor;
      // Slightly visible label on the right side of the plot (near threshold)
      // keep it subtle so it doesn't clutter the chart
      const label = b.rank.shortName;
      return `
        <rect x="${margin.left}" y="${b.yTop}" width="${plotW}" height="${b.h}" fill="${fill}" fill-opacity="0.20" stroke="${fill}" stroke-opacity="0.55" stroke-width="1" />
        <line x1="${margin.left}" y1="${b.yTop}" x2="${margin.left + plotW}" y2="${b.yTop}" stroke="${fill}" stroke-opacity="0.85" stroke-width="1.6" />
      `;
    })
    .join('\n');

  const rankIconsSvg = visibleBands
    .map((b) => {
      const dataUri = getRankIconDataUri(b.rank.iconFile);
      if (!dataUri) return '';

      const size = Math.min(iconSize, Math.max(10, b.h - 2));
      const iconX = margin.left + 8;
      const iconY = b.yTop + Math.max(0, (b.h - size) / 2);
      return `
        <image
          x="${iconX.toFixed(2)}"
          y="${iconY.toFixed(2)}"
          width="${size.toFixed(2)}"
          height="${size.toFixed(2)}"
          href="${dataUri}"
          xlink:href="${dataUri}"
          preserveAspectRatio="xMidYMid meet"
        />
      `;
    })
    .join('\n');

  // Draw lines for each player (stepped line like Trackmania Glicko)
  let linesSvg = '';
  const endLabels: { username: string; color: string; x: number; y: number; finalRating: number }[] = [];

  series.forEach((s) => {
    if (s.points.length === 0) return;

    let pathD = '';
    for (let i = 0; i < s.points.length; i++) {
      const pt = s.points[i];
      const x = getX(pt.time);
      const y = getY(pt.rating);

      if (i === 0) {
        pathD += `M ${x.toFixed(2)} ${y.toFixed(2)}`;
      } else {
        pathD += ` H ${x.toFixed(2)} V ${y.toFixed(2)}`;
      }
    }

    linesSvg += `
      <path d="${pathD}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
    `;

    const lastPt = s.points[s.points.length - 1];
    endLabels.push({
      username: s.username,
      color: s.color,
      x: getX(lastPt.time),
      y: getY(lastPt.rating),
      finalRating: lastPt.rating,
    });
  });

  // Anti-collision algorithm for right-side labels:
  // Sort from top to bottom by Y position, ensure at least 15px between labels
  endLabels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < endLabels.length; i++) {
    if (endLabels[i].y - endLabels[i - 1].y < 15) {
      endLabels[i].y = endLabels[i - 1].y + 15;
    }
  }

  let labelsSvg = '';
  for (const lbl of endLabels) {
    labelsSvg += `
      <text x="${margin.left + plotW + 10}" y="${lbl.y + 4}" fill="${lbl.color}" font-size="11" font-weight="bold" font-family="sans-serif">${lbl.username}</text>
    `;
  }

  // Dynamic compact legend box: calculate exact width needed by text length
  const maxNameLength = Math.max(...series.map(s => s.username.length), 6);
  // Approx 6.5px per character for font-size 10.5
  const colWidth = Math.max(90, Math.min(130, Math.round(maxNameLength * 6.8 + 26)));
  const numColumns = series.length > 10 ? 2 : 1;
  const rowHeight = 16;
  const rowsPerCol = Math.ceil(series.length / numColumns);
  const legendBoxW = numColumns * colWidth + 16;
  const legendBoxH = rowsPerCol * rowHeight + 14;
  const legendBoxX = margin.left + 14;
  const legendBoxY = margin.top + plotH - legendBoxH - 14;

  let legendItemsSvg = '';
  series.forEach((s, idx) => {
    const col = Math.floor(idx / rowsPerCol);
    const row = idx % rowsPerCol;
    const itemX = legendBoxX + 10 + col * colWidth;
    const itemY = legendBoxY + 9 + row * rowHeight;

    legendItemsSvg += `
      <line x1="${itemX}" y1="${itemY + 4}" x2="${itemX + 12}" y2="${itemY + 4}" stroke="${s.color}" stroke-width="2.5" />
      <circle cx="${itemX + 6}" cy="${itemY + 4}" r="2" fill="${s.color}" />
      <text x="${itemX + 17}" y="${itemY + 7}" fill="#ffffff" font-size="10.5" font-weight="500" font-family="sans-serif">${s.username}</text>
    `;
  });

  const legendSvg = `
    <!-- Legend Container Box (Ultra-compact & translucent) -->
    <rect x="${legendBoxX}" y="${legendBoxY}" width="${legendBoxW}" height="${legendBoxH}" rx="5" fill="#050608" fill-opacity="0.92" stroke="#252932" stroke-width="1" />
    ${legendItemsSvg}
  `;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background-color: #060709;">
      <defs>
        <clipPath id="plotClip">
          <rect x="${margin.left}" y="${margin.top}" width="${plotW}" height="${plotH}" />
        </clipPath>
      </defs>

      <!-- Title -->
      <text x="${width / 2}" y="36" fill="#e6edf3" font-size="16" font-weight="600" text-anchor="middle" font-family="sans-serif">
        Glicko-2 Rating History for TM Players
      </text>

      <!-- Y-Axis Label -->
      <text transform="rotate(-90)" x="${-(margin.top + plotH / 2)}" y="25" fill="#8b949e" font-size="11" text-anchor="middle" font-family="sans-serif">
        Glicko2 Rating
      </text>

      <!-- X-Axis Label -->
      <text x="${margin.left + plotW / 2}" y="${height - 25}" fill="#8b949e" font-size="11" text-anchor="middle" font-family="sans-serif">
        COTD Date
      </text>

      <!-- Plot Area Axes Lines -->
      <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotH}" stroke="#2b313a" stroke-width="1" />
      <line x1="${margin.left}" y1="${margin.top + plotH}" x2="${margin.left + plotW}" y2="${margin.top + plotH}" stroke="#2b313a" stroke-width="1" />

      <g clip-path="url(#plotClip)">
        ${rankZonesSvg}
        ${gridLinesSvg}
        ${rankIconsSvg}
        ${linesSvg}
      </g>

      ${axisLabelsSvg}

      <!-- Rank icons above lines/legend so they stay visible in the PNG -->
      ${rankIconsSvg}

      <!-- End labels -->
      ${labelsSvg}

      <!-- Legend -->
      ${legendSvg}
    </svg>
  `.trim();
}
