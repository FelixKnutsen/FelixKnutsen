import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const USERNAME = 'FelixKnutsen';
const START_YEAR = 2022;
const END_YEAR = 2026;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const SQUARE = 10;
const GAP = 3;
const PITCH = SQUARE + GAP;
const GRID_X = 126;
const HEADER_HEIGHT = 137;
const ROW_HEIGHT = 116;
const WIDTH = 900;
const HEIGHT = HEADER_HEIGHT + (END_YEAR - START_YEAR + 1) * ROW_HEIGHT + 42;
const SNAKE_DURATION_SECONDS = 120;
const SNAKE_BODY_SEGMENTS = 10;
const SNAKE_SEGMENT_SPACING = 12;
const SNAKE_LEFT_RAIL_X = 104;
const SNAKE_RIGHT_RAIL_X = 833;
const SNAKE_RETURN_LEFT_X = 112;
const SNAKE_RETURN_RIGHT_X = 889;
const SNAKE_RETURN_Y = 124;
const OUTPUT_DIR = path.resolve(process.cwd(), 'dist');

const GRAPHQL_QUERY = `
  query($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              contributionCount
              date
            }
          }
        }
      }
    }
  }
`;

const palettes = {
  light: {
    text: '#24292f',
    muted: '#57606a',
    empty: '#ebedf0',
    card: '#f7f8ff',
    border: '#e0e4f4',
    accent: '#3b45f2',
    levels: ['#c8ccff', '#9ca3ff', '#707bff', '#3b45f2'],
    snake: '#3b45f2',
    snakeEye: '#ffffff',
  },
  dark: {
    text: '#e6edf3',
    muted: '#8b949e',
    empty: '#30363d',
    card: '#171d2c',
    border: '#30384d',
    accent: '#8d95ff',
    levels: ['#25346b', '#3449a8', '#5967e9', '#8d95ff'],
    snake: '#8d95ff',
    snakeEye: '#171d2c',
  },
};

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const numberFormat = new Intl.NumberFormat('en-GB');

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function dayColumn(dateString, year) {
  const janFirst = new Date(Date.UTC(year, 0, 1));
  const firstSunday = new Date(janFirst.getTime() - janFirst.getUTCDay() * DAY_MS);
  const day = new Date(`${dateString}T00:00:00Z`);
  return Math.floor((day.getTime() - firstSunday.getTime()) / WEEK_MS);
}

function contributionFill(count, palette) {
  if (count <= 0) return palette.empty;
  if (count <= 2) return palette.levels[0];
  if (count <= 5) return palette.levels[1];
  if (count <= 9) return palette.levels[2];
  return palette.levels[3];
}

async function fetchYear(year, today) {
  const token = process.env.GH_TOKEN;
  if (!token) {
    throw new Error('GH_TOKEN is missing. Run this script through the included GitHub Actions workflow.');
  }

  const startDate = `${year}-01-01`;
  const endDate = year === today.getUTCFullYear() ? isoDate(today) : `${year}-12-31`;
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'FelixKnutsen-five-year-contribution-heatmap',
    },
    body: JSON.stringify({
      query: GRAPHQL_QUERY,
      variables: {
        login: USERNAME,
        from: `${startDate}T00:00:00Z`,
        to: `${endDate}T23:59:59Z`,
      },
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`GitHub GraphQL returned HTTP ${response.status}: ${details}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(`GitHub GraphQL query failed: ${payload.errors.map((item) => item.message).join('; ')}`);
  }

  const calendar = payload.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendar) {
    throw new Error(`GitHub did not return a contribution calendar for ${USERNAME} in ${year}.`);
  }

  const counts = new Map();
  for (const week of calendar.weeks) {
    for (const day of week.contributionDays) {
      if (day.date >= startDate && day.date <= endDate) {
        counts.set(day.date, day.contributionCount);
      }
    }
  }

  return { year, startDate, endDate, total: Number(calendar.totalContributions ?? 0), counts };
}

function makeDailyHistory(years) {
  const allDays = [];
  const enrichedYears = years.map((yearData) => {
    const daily = [];
    for (let cursor = new Date(`${yearData.startDate}T00:00:00Z`);
      cursor <= new Date(`${yearData.endDate}T00:00:00Z`);
      cursor = new Date(cursor.getTime() + DAY_MS)) {
      const date = isoDate(cursor);
      daily.push({ date, time: cursor.getTime(), count: yearData.counts.get(date) ?? 0 });
    }
    allDays.push(...daily);
    return { ...yearData, activeDays: daily.filter((day) => day.count > 0).length };
  });
  return { allDays, enrichedYears };
}

function calculateInsights(years) {
  const { allDays, enrichedYears } = makeDailyHistory(years);
  const total = enrichedYears.reduce((sum, year) => sum + year.total, 0);
  const activeDays = allDays.filter((day) => day.count > 0).length;

  let longestStreak = 0;
  let currentStreak = 0;
  let previousActiveTime = null;
  for (const day of allDays) {
    if (day.count > 0) {
      currentStreak = previousActiveTime !== null && day.time - previousActiveTime === DAY_MS
        ? currentStreak + 1
        : 1;
      longestStreak = Math.max(longestStreak, currentStreak);
      previousActiveTime = day.time;
    } else {
      currentStreak = 0;
      previousActiveTime = null;
    }
  }

  const peakDay = allDays.reduce((best, day) => day.count > (best?.count ?? 0) ? day : best, null);
  const hasPeak = Boolean(peakDay && peakDay.count > 0);
  const bestYear = [...enrichedYears].sort((a, b) => b.total - a.total)[0];

  return {
    years: enrichedYears,
    total,
    activeDays,
    longestStreak,
    peakDay: hasPeak ? peakDay : null,
    bestYear,
  };
}

function shortDate(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  return `${date.getUTCDate()} ${monthNames[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function cellKey(year, col, weekday) {
  return `${year}:${col}:${weekday}`;
}

function buildSnakeTrack(years) {
  const points = [];
  const allCellDistances = new Map();

  const addPoint = (x, y, key = null) => points.push({ x, y, key });

  years.forEach((yearData, yearIndex) => {
    const rowTop = HEADER_HEIGHT + yearIndex * ROW_HEIGHT;
    const dateAtPosition = new Map();
    for (const date of yearData.counts.keys()) {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      dateAtPosition.set(`${dayColumn(date, yearData.year)}:${weekday}`, date);
    }

    for (let weekday = 0; weekday < 7; weekday += 1) {
      const globalRow = yearIndex * 7 + weekday;
      const forward = globalRow % 2 === 0;
      const columns = forward
        ? Array.from({ length: 53 }, (_, col) => col)
        : Array.from({ length: 53 }, (_, col) => 52 - col);
      const y = rowTop + 25 + weekday * PITCH + SQUARE / 2;

      for (const col of columns) {
        const date = dateAtPosition.get(`${col}:${weekday}`);
        addPoint(
          GRID_X + col * PITCH + SQUARE / 2,
          y,
          date ? cellKey(yearData.year, col, weekday) : null,
        );
      }

      // At each year boundary, route around the month labels instead of passing over them.
      if (weekday === 6 && yearIndex < years.length - 1) {
        const endpoint = points.at(-1);
        const nextRowTop = HEADER_HEIGHT + (yearIndex + 1) * ROW_HEIGHT;
        const nextY = nextRowTop + 25 + SQUARE / 2;
        const railX = endpoint.x > WIDTH / 2 ? SNAKE_RIGHT_RAIL_X : SNAKE_LEFT_RAIL_X;
        addPoint(railX, endpoint.y);
        addPoint(railX, nextY);
        // The next row starts at this same side because the rows alternate direction.
      }
    }
  });

  // Close the route around the outside of the grid so the animation loops cleanly.
  const first = points[0];
  const last = points.at(-1);
  addPoint(SNAKE_RETURN_RIGHT_X, last.y);
  addPoint(SNAKE_RETURN_RIGHT_X, SNAKE_RETURN_Y);
  addPoint(SNAKE_RETURN_LEFT_X, SNAKE_RETURN_Y);
  addPoint(SNAKE_RETURN_LEFT_X, first.y);
  addPoint(first.x, first.y);

  let length = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (index > 0) {
      const previous = points[index - 1];
      length += Math.hypot(point.x - previous.x, point.y - previous.y);
    }
    if (point.key) allCellDistances.set(point.key, length);
  }

  const path = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');

  return {
    path,
    length,
    distanceByCell: allCellDistances,
  };
}

function renderEatAnimation(baseFill, fraction, palette, duration = SNAKE_DURATION_SECONDS) {
  const eatAt = Math.max(0.001, Math.min(0.998, fraction));
  const holdAt = Math.max(0.0001, eatAt - 0.0001);
  return `<animate attributeName="fill" values="${baseFill};${baseFill};${palette.empty};${palette.empty};${baseFill}" keyTimes="0;${holdAt.toFixed(5)};${eatAt.toFixed(5)};0.9999;1" dur="${duration}s" repeatCount="indefinite" />`;
}

function renderSnake(track, palette) {
  const elements = [];
  const speed = track.length / SNAKE_DURATION_SECONDS;
  const delayPerSegment = SNAKE_SEGMENT_SPACING / speed;

  // Draw the tail first so the head remains on top of the body.
  for (let index = SNAKE_BODY_SEGMENTS; index >= 1; index -= 1) {
    const delay = index * delayPerSegment;
    const begin = -(SNAKE_DURATION_SECONDS - delay);
    const radius = Math.max(2.7, 4.1 - index * 0.1);
    elements.push(`<circle cx="0" cy="0" r="${radius.toFixed(2)}" fill="${palette.snake}" stroke="${palette.card}" stroke-width="1.25"><animateMotion dur="${SNAKE_DURATION_SECONDS}s" begin="${begin.toFixed(4)}s" repeatCount="indefinite" rotate="auto"><mpath href="#snake-track" xlink:href="#snake-track" /></animateMotion></circle>`);
  }

  elements.push(`<g aria-label="Animated snake eating the five-year contribution heatmap"><animateMotion dur="${SNAKE_DURATION_SECONDS}s" repeatCount="indefinite" rotate="auto"><mpath href="#snake-track" xlink:href="#snake-track" /></animateMotion><circle cx="0" cy="0" r="5.1" fill="${palette.snake}" stroke="${palette.card}" stroke-width="1.5"/><circle cx="2.1" cy="-1.65" r="1.05" fill="${palette.snakeEye}"/><circle cx="2.1" cy="1.65" r="1.05" fill="${palette.snakeEye}"/></g>`);
  return elements.join('\n');
}

function renderSvg(years, theme, generatedOn, preview = false) {
  const palette = palettes[theme];
  const insights = calculateInsights(years);
  const currentEndLabel = years.at(-1)?.endDate ?? `${END_YEAR}-01-01`;
  const track = buildSnakeTrack(years);
  const elements = [];
  const font = '-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif';

  elements.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="title desc">`);
  elements.push(`<title id="title">Animated GitHub contribution heatmap for ${START_YEAR}–${END_YEAR}</title>`);
  elements.push(`<desc id="desc">A single animated five-year contribution heatmap for ${escapeXml(USERNAME)}, generated on ${escapeXml(generatedOn)}. The snake travels across the grid and consumes active contribution squares before the animation resets. ${numberFormat.format(insights.total)} total contributions, ${numberFormat.format(insights.activeDays)} active days, and a longest streak of ${insights.longestStreak} days.</desc>`);
  elements.push(`<defs><path id="snake-track" d="${track.path}" fill="none" /></defs>`);
  elements.push(`<text x="20" y="28" fill="${palette.text}" font-family="${font}" font-size="19" font-weight="700">GitHub contributions · ${START_YEAR}–${END_YEAR}</text>`);
  const subtitle = preview
    ? 'Illustrative preview · sample data, not Felix’s actual contribution history'
    : `Five-year activity overview · updated ${generatedOn} · ${END_YEAR} year-to-date`;
  elements.push(`<text x="20" y="47" fill="${palette.muted}" font-family="${font}" font-size="11">${escapeXml(subtitle)}</text>`);

  const cardY = 61;
  const cardH = 54;
  const cardW = 210;
  const cardGap = 8;
  const firstCardX = 18;
  const peakValue = insights.peakDay
    ? `${numberFormat.format(insights.peakDay.count)} · ${shortDate(insights.peakDay.date)}`
    : 'No contributions yet';
  const cards = [
    { label: 'TOTAL CONTRIBUTIONS', value: numberFormat.format(insights.total), size: 19 },
    { label: 'ACTIVE DAYS', value: numberFormat.format(insights.activeDays), size: 19 },
    { label: 'LONGEST STREAK', value: `${numberFormat.format(insights.longestStreak)} day${insights.longestStreak === 1 ? '' : 's'}`, size: 18 },
    { label: 'PEAK DAY', value: peakValue, size: peakValue.length > 15 ? 13 : 17 },
  ];
  cards.forEach((card, index) => {
    const x = firstCardX + index * (cardW + cardGap);
    elements.push(`<rect x="${x}" y="${cardY}" width="${cardW}" height="${cardH}" rx="7" fill="${palette.card}" stroke="${palette.border}"/>`);
    elements.push(`<rect x="${x}" y="${cardY + 9}" width="3" height="36" rx="1.5" fill="${palette.accent}"/>`);
    elements.push(`<text x="${x + 13}" y="${cardY + 18}" fill="${palette.muted}" font-family="${font}" font-size="9" font-weight="600" letter-spacing="0.5">${escapeXml(card.label)}</text>`);
    elements.push(`<text x="${x + 13}" y="${cardY + 41}" fill="${palette.text}" font-family="${font}" font-size="${card.size}" font-weight="700">${escapeXml(card.value)}</text>`);
  });

  insights.years.forEach((yearData, index) => {
    const rowTop = HEADER_HEIGHT + index * ROW_HEIGHT;
    const year = yearData.year;
    elements.push(`<text x="18" y="${rowTop + 50}" fill="${palette.text}" font-family="${font}" font-size="16" font-weight="700">${year}</text>`);
    elements.push(`<text x="18" y="${rowTop + 67}" fill="${palette.muted}" font-family="${font}" font-size="8.5">${numberFormat.format(yearData.total)} contributions</text>`);
    elements.push(`<text x="18" y="${rowTop + 80}" fill="${palette.muted}" font-family="${font}" font-size="8.5">${numberFormat.format(yearData.activeDays)} active days</text>`);

    for (let month = 0; month < 12; month += 1) {
      const firstOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      if (firstOfMonth > yearData.endDate) break;
      const x = GRID_X + dayColumn(firstOfMonth, year) * PITCH;
      elements.push(`<text x="${x}" y="${rowTop + 14}" fill="${palette.muted}" font-family="${font}" font-size="10">${monthNames[month]}</text>`);
    }

    const start = new Date(`${year}-01-01T00:00:00Z`);
    const end = new Date(`${yearData.endDate}T00:00:00Z`);
    for (let cursor = new Date(start); cursor <= end; cursor = new Date(cursor.getTime() + DAY_MS)) {
      const date = isoDate(cursor);
      const count = yearData.counts.get(date) ?? 0;
      const col = dayColumn(date, year);
      const weekday = cursor.getUTCDay();
      const x = GRID_X + col * PITCH;
      const y = rowTop + 25 + weekday * PITCH;
      const title = `${date}: ${numberFormat.format(count)} contribution${count === 1 ? '' : 's'}`;
      const isPeak = insights.peakDay?.date === date;
      const peakMark = isPeak ? ` stroke="${palette.accent}" stroke-width="1.5"` : '';
      let cellMarkup = `<rect x="${x}" y="${y}" width="${SQUARE}" height="${SQUARE}" rx="2" fill="${contributionFill(count, palette)}"${peakMark}><title>${escapeXml(title)}</title>`;
      if (count > 0) {
        const distance = track.distanceByCell.get(cellKey(year, col, weekday));
        const fraction = distance === undefined ? 0.5 : distance / track.length;
        cellMarkup += renderEatAnimation(contributionFill(count, palette), fraction, palette);
        if (isPeak) {
          const eatAt = Math.max(0.001, Math.min(0.998, fraction));
          const holdAt = Math.max(0.0001, eatAt - 0.0001);
          cellMarkup += `<animate attributeName="stroke" values="${palette.accent};${palette.accent};${palette.empty};${palette.empty};${palette.accent}" keyTimes="0;${holdAt.toFixed(5)};${eatAt.toFixed(5)};0.9999;1" dur="${SNAKE_DURATION_SECONDS}s" repeatCount="indefinite" />`;
        }
      }
      cellMarkup += '</rect>';
      elements.push(cellMarkup);
    }
  });

  const footerY = HEIGHT - 20;
  const footerText = preview
    ? 'Illustrative preview only · real totals appear after the GitHub Actions workflow runs'
    : `One square per day · snake consumes active squares · data through ${currentEndLabel}`;
  elements.push(`<text x="20" y="${footerY + 4}" fill="${palette.muted}" font-family="${font}" font-size="9">${escapeXml(footerText)}</text>`);
  elements.push(`<text x="${WIDTH - 156}" y="${footerY + 4}" fill="${palette.muted}" font-family="${font}" font-size="10">Less</text>`);
  const legendStart = WIDTH - 122;
  [0, 1, 3, 6, 10].forEach((count, index) => {
    elements.push(`<rect x="${legendStart + index * 13}" y="${footerY - 7}" width="9" height="9" rx="2" fill="${contributionFill(count, palette)}"/>`);
  });
  elements.push(`<text x="${WIDTH - 35}" y="${footerY + 4}" fill="${palette.muted}" font-family="${font}" font-size="10">More</text>`);
  elements.push(renderSnake(track, palette));
  elements.push('</svg>');

  return `${elements.join('\n')}\n`;
}

function makePreviewYears(today) {
  const years = [];
  const lastYear = Math.min(END_YEAR, today.getUTCFullYear());
  for (let year = START_YEAR; year <= lastYear; year += 1) {
    const startDate = `${year}-01-01`;
    const endDate = year === today.getUTCFullYear() ? isoDate(today) : `${year}-12-31`;
    const counts = new Map();
    let total = 0;
    let dayIndex = 0;
    for (let cursor = new Date(`${startDate}T00:00:00Z`);
      cursor <= new Date(`${endDate}T00:00:00Z`);
      cursor = new Date(cursor.getTime() + DAY_MS), dayIndex += 1) {
      const date = isoDate(cursor);
      const seasonalWave = (Math.sin((dayIndex + year * 19) / 31) + 1) / 2;
      const pseudoRandom = (dayIndex * 73 + year * 173 + Math.floor(dayIndex / 7) * 41) % 100;
      const activityChance = 12 + seasonalWave * 28;
      let count = 0;
      if (pseudoRandom < activityChance) {
        count = 1 + ((dayIndex * 7 + year * 3 + pseudoRandom) % (seasonalWave > 0.55 ? 11 : 5));
      }
      counts.set(date, count);
      total += count;
    }
    years.push({ year, startDate, endDate, total, counts });
  }
  return years;
}

async function main() {
  const today = new Date();
  const currentYear = today.getUTCFullYear();
  const lastYear = Math.min(END_YEAR, currentYear);
  if (lastYear < START_YEAR) {
    throw new Error(`The current year is before the configured start year ${START_YEAR}.`);
  }

  const preview = process.argv.includes('--preview');
  const years = [];
  if (preview) {
    years.push(...makePreviewYears(today));
  } else {
    for (let year = START_YEAR; year <= lastYear; year += 1) {
      console.log(`Fetching public contribution calendar for ${year}...`);
      years.push(await fetchYear(year, today));
    }
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  const generatedOn = isoDate(today);
  await writeFile(path.join(OUTPUT_DIR, 'contributions-2022-2026-snake-light.svg'), renderSvg(years, 'light', generatedOn, preview), 'utf8');
  await writeFile(path.join(OUTPUT_DIR, 'contributions-2022-2026-snake-dark.svg'), renderSvg(years, 'dark', generatedOn, preview), 'utf8');

  const insights = calculateInsights(years);
  const prefix = preview ? 'Preview only. ' : '';
  console.log(`${prefix}Created one animated five-year heatmap with a contribution snake: ${numberFormat.format(insights.total)} contributions, ${numberFormat.format(insights.activeDays)} active days, and a ${insights.longestStreak}-day longest streak in ${OUTPUT_DIR}.`);
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
