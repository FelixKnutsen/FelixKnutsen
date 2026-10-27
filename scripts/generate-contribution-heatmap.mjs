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
const GRID_X = 114;
const HEADER_HEIGHT = 78;
const ROW_HEIGHT = 116;
const WEEK_COLUMNS = 53;
const WIDTH = 830;
const HEIGHT = HEADER_HEIGHT + (END_YEAR - START_YEAR + 1) * ROW_HEIGHT + 52;
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
    levels: ['#c8ccff', '#9ca3ff', '#707bff', '#3b45f2'],
  },
  dark: {
    text: '#e6edf3',
    muted: '#8b949e',
    empty: '#30363d',
    levels: ['#25346b', '#3449a8', '#5967e9', '#8d95ff'],
  },
};

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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
  const endDate = year === today.getUTCFullYear()
    ? isoDate(today)
    : `${year}-12-31`;

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

  return {
    year,
    startDate,
    endDate,
    total: Number(calendar.totalContributions ?? 0),
    counts,
  };
}

function renderSvg(years, theme, generatedOn) {
  const palette = palettes[theme];
  const total = years.reduce((sum, item) => sum + item.total, 0);
  const currentEndLabel = years.at(-1)?.endDate ?? `${END_YEAR}-01-01`;
  const footerText = `One square per day · GitHub contribution calendar · Data through ${currentEndLabel}`;
  const elements = [];

  elements.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="title desc">`);
  elements.push(`<title id="title">GitHub contributions for ${START_YEAR}–${END_YEAR}</title>`);
  elements.push(`<desc id="desc">A five-year daily contribution heatmap for ${escapeXml(USERNAME)}, generated on ${escapeXml(generatedOn)}. ${numberFormat.format(total)} total contributions.</desc>`);
  elements.push(`<text x="20" y="30" fill="${palette.text}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="18" font-weight="700">GitHub contributions · ${START_YEAR}–${END_YEAR}</text>`);
  elements.push(`<text x="20" y="50" fill="${palette.muted}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="11">Daily contribution history · ${END_YEAR} year-to-date</text>`);
  elements.push(`<text x="${WIDTH - 18}" y="30" text-anchor="end" fill="${palette.text}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="14" font-weight="700">${numberFormat.format(total)} total</text>`);
  elements.push(`<text x="${WIDTH - 18}" y="48" text-anchor="end" fill="${palette.muted}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="10">${START_YEAR}–${END_YEAR}</text>`);

  years.forEach((yearData, index) => {
    const rowTop = HEADER_HEIGHT + index * ROW_HEIGHT;
    const year = yearData.year;
    elements.push(`<text x="18" y="${rowTop + 51}" fill="${palette.text}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="16" font-weight="700">${year}</text>`);
    elements.push(`<text x="18" y="${rowTop + 67}" fill="${palette.muted}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="9">${numberFormat.format(yearData.total)} total</text>`);

    for (let month = 0; month < 12; month += 1) {
      const firstOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      if (firstOfMonth > yearData.endDate) break;
      const x = GRID_X + dayColumn(firstOfMonth, year) * PITCH;
      elements.push(`<text x="${x}" y="${rowTop + 14}" fill="${palette.muted}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="10">${monthNames[month]}</text>`);
    }

    [1, 3, 5].forEach((weekday) => {
      const y = rowTop + 25 + weekday * PITCH + 8;
      elements.push(`<text x="${GRID_X - 8}" y="${y}" text-anchor="end" fill="${palette.muted}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="9">${weekdayNames[weekday]}</text>`);
    });

    const start = new Date(`${year}-01-01T00:00:00Z`);
    const end = new Date(`${yearData.endDate}T00:00:00Z`);
    for (let cursor = new Date(start); cursor <= end; cursor = new Date(cursor.getTime() + DAY_MS)) {
      const date = isoDate(cursor);
      const count = yearData.counts.get(date) ?? 0;
      const x = GRID_X + dayColumn(date, year) * PITCH;
      const y = rowTop + 25 + cursor.getUTCDay() * PITCH;
      const title = `${date}: ${count} contribution${count === 1 ? '' : 's'}`;
      elements.push(`<rect x="${x}" y="${y}" width="${SQUARE}" height="${SQUARE}" rx="2" fill="${contributionFill(count, palette)}"><title>${escapeXml(title)}</title></rect>`);
    }
  });

  const footerY = HEIGHT - 20;
  elements.push(`<text x="20" y="${footerY + 4}" fill="${palette.muted}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="9">${escapeXml(footerText)}</text>`);
  elements.push(`<text x="${WIDTH - 156}" y="${footerY + 4}" fill="${palette.muted}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="10">Less</text>`);
  const legendStart = WIDTH - 122;
  const legendCounts = [0, 1, 3, 6, 10];
  legendCounts.forEach((count, index) => {
    elements.push(`<rect x="${legendStart + index * 13}" y="${footerY - 7}" width="9" height="9" rx="2" fill="${contributionFill(count, palette)}"/>`);
  });
  elements.push(`<text x="${WIDTH - 35}" y="${footerY + 4}" fill="${palette.muted}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="10">More</text>`);
  elements.push('</svg>');

  return `${elements.join('\n')}\n`;
}

async function main() {
  const today = new Date();
  const currentYear = today.getUTCFullYear();
  const lastYear = Math.min(END_YEAR, currentYear);
  if (lastYear < START_YEAR) {
    throw new Error(`The current year is before the configured start year ${START_YEAR}.`);
  }

  const years = [];
  for (let year = START_YEAR; year <= lastYear; year += 1) {
    console.log(`Fetching public contribution calendar for ${year}...`);
    years.push(await fetchYear(year, today));
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  const generatedOn = isoDate(today);
  await writeFile(path.join(OUTPUT_DIR, 'contributions-2022-2026-light.svg'), renderSvg(years, 'light', generatedOn), 'utf8');
  await writeFile(path.join(OUTPUT_DIR, 'contributions-2022-2026-dark.svg'), renderSvg(years, 'dark', generatedOn), 'utf8');

  const total = years.reduce((sum, item) => sum + item.total, 0);
  console.log(`Created two five-year heatmaps with ${numberFormat.format(total)} total contributions in ${OUTPUT_DIR}.`);
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
