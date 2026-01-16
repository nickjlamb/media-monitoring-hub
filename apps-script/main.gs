/**
 * Entry point for the daily media monitoring run.
 * Designed to be triggered once per day.
 */
function runDailyMediaMonitoring() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

try {
    const newEntries = fetchAllSources(ss);
    const insertedCount = storeNewEntries(ss, newEntries);
    Logger.log('Inserted count: ' + insertedCount);

    if (insertedCount > 0) {
      generateDailySummary(ss, insertedCount);
    }

    updateLastRun(ss);
  } catch (error) {
    Logger.log('Run failed: ' + error.message);
    throw error;
  }
}


/**
 * Fetches entries from all enabled sources defined in the Config sheet.
 */
function fetchAllSources(ss) {
  const configSheet = ss.getSheetByName('Config');
  const rows = configSheet.getDataRange().getValues();
  rows.shift(); // remove header row

  const entries = [];

  rows.forEach(row => {
    const [source, enabled, endpoint, query] = row;

    if (enabled !== true) return;

    if (endpoint === 'RSS') {
      entries.push(...fetchFromRss(source, query));
    }

    if (endpoint === 'API') {
      entries.push(...fetchFromApi(source, query));
    }
  });

  return entries;
}

/**
 * Generates a grounded, comparative Gemini summary.
 * Uses gemini-1.0-pro for fast daily synthesis.
 */
function generateGeminiSummary(todaysEntries, yesterdaysSummary) {
  const apiKey = PropertiesService
    .getScriptProperties()
    .getProperty('GEMINI_API_KEY');

  if (!apiKey) {
    throw new Error('Gemini API key missing');
  }

  const prompt = `
You are assisting an internal communications and insights team.

TASK:
Analyze ONLY the new media items provided for today.
Compare them with yesterday's summary where relevant.

CONSTRAINTS:
- Do not speculate beyond the provided items.
- Do not invent trends.
- If no meaningful change is observed, say so explicitly.

OUTPUT FORMAT (plain text, no markdown):
Dominant themes today:
- ...

Changes vs yesterday:
- ...

Emerging narratives to watch:
- ...

YESTERDAY'S SUMMARY:
${JSON.stringify(yesterdaysSummary, null, 2)}

TODAY'S NEW ITEMS:
${JSON.stringify(todaysEntries, null, 2)}
`;

  const response = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=' + apiKey,
    {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      }),
      muteHttpExceptions: true
    }
  );

if (response.getResponseCode() !== 200) {
  Logger.log('Gemini status: ' + response.getResponseCode());
  Logger.log('Gemini response: ' + response.getContentText());
  throw new Error('Gemini request failed');
}

  const result = JSON.parse(response.getContentText());

  if (!result.candidates || !result.candidates.length) {
    throw new Error('Gemini returned no candidates');
  }

  const parts = result.candidates[0].content?.parts;
  if (!parts || !parts.length) {
    throw new Error('Gemini returned empty content');
  }

  return parts[0].text;
}

/**
 * Fetches and parses entries from RSS or Atom feeds.
 */
function fetchFromRss(sourceName, feedUrl) {
  if (!feedUrl) return [];

  const response = UrlFetchApp.fetch(feedUrl, {
    muteHttpExceptions: true,
    followRedirects: true
  });

  if (response.getResponseCode() !== 200) {
    Logger.log(`Feed fetch failed for ${sourceName}`);
    return [];
  }

  const xml = XmlService.parse(response.getContentText());
  const root = xml.getRootElement();
  const namespace = root.getNamespace();
  const fetchedDate = new Date();

  // ---- Atom feeds (e.g. Google Alerts) ----
  if (root.getName() === 'feed') {
    const entries = root.getChildren('entry', namespace);

    return entries.map(entry => {
      const title = entry.getChildText('title', namespace) || '';
      const linkEl = entry.getChildren('link', namespace)[0];
      const link = linkEl ? linkEl.getAttribute('href').getValue() : '';

      const content =
        entry.getChildText('content', namespace) ||
        entry.getChildText('summary', namespace) ||
        '';

      const publishedRaw =
        entry.getChildText('published', namespace) ||
        entry.getChildText('updated', namespace);

      let publishedDate = '';
      if (publishedRaw) {
        const parsed = new Date(publishedRaw);
        if (!isNaN(parsed)) {
          publishedDate = parsed;
        }
      }

      return {
        fetchedDate,
        source: sourceName,
        title,
        snippet: stripHtml(content),
        url: link,
        publishedDate,
        entryId: generateEntryId(title, link)
      };
    });
  }

  // ---- RSS fallback ----
  const channel = root.getChild('channel', namespace);
  if (!channel) {
    Logger.log(`Unsupported feed format for ${sourceName}`);
    return [];
  }

  const items = channel.getChildren('item', namespace);

  return items.map(item => {
    const title = item.getChildText('title', namespace) || '';
    const link = item.getChildText('link', namespace) || '';
    const description = item.getChildText('description', namespace) || '';
    const pubDateRaw = item.getChildText('pubDate', namespace);

    let publishedDate = '';
    if (pubDateRaw) {
      const parsed = new Date(pubDateRaw);
      if (!isNaN(parsed)) {
        publishedDate = parsed;
      }
    }

    return {
      fetchedDate,
      source: sourceName,
      title,
      snippet: stripHtml(description),
      url: link,
      publishedDate,
      entryId: generateEntryId(title, link)
    };
  });
}

/**
 * Fetches entries from API-based sources.
 * v1 supports YouTube Search API.
 */
function fetchFromApi(sourceName, query) {
  if (sourceName !== 'YouTube' || !query) return [];

  const apiKey = PropertiesService
    .getScriptProperties()
    .getProperty('YOUTUBE_API_KEY');

  if (!apiKey) {
    Logger.log('YouTube API key missing');
    return [];
  }

  const url =
    'https://www.googleapis.com/youtube/v3/search' +
    '?part=snippet' +
    '&type=video' +
    '&order=date' +
    '&maxResults=10' +
    '&q=' + encodeURIComponent(query) +
    '&key=' + apiKey;

  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    Logger.log('YouTube API fetch failed');
    return [];
  }

  const data = JSON.parse(response.getContentText());
  const fetchedDate = new Date();

  return (data.items || []).map(item => {
    const snippet = item.snippet || {};
    const title = snippet.title || '';
    const description = snippet.description || '';
    const videoId = item.id && item.id.videoId;
    const link = videoId
      ? `https://www.youtube.com/watch?v=${videoId}`
      : '';

    let publishedDate = '';
    if (snippet.publishedAt) {
      const parsed = new Date(snippet.publishedAt);
      if (!isNaN(parsed)) {
        publishedDate = parsed;
      }
    }

    return {
      fetchedDate,
      source: sourceName,
      title,
      snippet: description,
      url: link,
      publishedDate,
      entryId: generateEntryId(title, link)
    };
  });
}

/**
 * Returns all entries fetched today.
 */
function getTodaysEntries(ss) {
  const sheet = ss.getSheetByName('Raw_Entries');
  const rows = sheet.getDataRange().getValues();
  rows.shift();

  const todayStr = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd'
  );

  return rows.filter(row => {
    const fetchedDate = row[0];
    if (!(fetchedDate instanceof Date)) return false;

    const rowDateStr = Utilities.formatDate(
      fetchedDate,
      Session.getScriptTimeZone(),
      'yyyy-MM-dd'
    );

    return rowDateStr === todayStr;
  }).map(row => ({
    source: row[1],
    title: row[2],
    snippet: row[3],
    url: row[4]
  }));
}

/**
 * Returns yesterday's summary in a consistent object shape.
 */
function getYesterdaysSummary(ss) {
  const sheet = ss.getSheetByName('Daily_Summaries');
  const rows = sheet.getDataRange().getValues();

  if (rows.length <= 1) {
    return {
      dominantThemes: '',
      emergingNarratives: ''
    };
  }

  const yesterdayRow = rows[rows.length - 2];
  return {
    dominantThemes: yesterdayRow[2] || '',
    emergingNarratives: yesterdayRow[4] || ''
  };
}

/**
 * Stores only genuinely new entries in the Raw_Entries sheet.
 */
function storeNewEntries(ss, entries) {
  if (!entries.length) return 0;

  const sheet = ss.getSheetByName('Raw_Entries');
  const lastRow = sheet.getLastRow();

  const existingIds = new Set(
    lastRow > 1
      ? sheet.getRange(2, 7, lastRow - 1, 1).getValues().flat()
      : []
  );

  const rowsToInsert = [];

  entries.forEach(entry => {
    if (existingIds.has(entry.entryId)) return;

    rowsToInsert.push([
      entry.fetchedDate,
      entry.source,
      entry.title,
      entry.snippet,
      entry.url,
      entry.publishedDate,
      entry.entryId
    ]);
  });

  if (rowsToInsert.length) {
    sheet
      .getRange(sheet.getLastRow() + 1, 1, rowsToInsert.length, rowsToInsert[0].length)
      .setValues(rowsToInsert);
  }

  return rowsToInsert.length;
}

/**
 * Generates the daily narrative summary (idempotent per day).
 */
function generateDailySummary(ss, newItemCount) {
  const todaysEntries = getTodaysEntries(ss);
  if (!todaysEntries.length) return;

  const sheet = ss.getSheetByName('Daily_Summaries');
  const today = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd'
  );

  if (summaryExistsForToday(sheet, today)) return;

  const yesterdaysSummary = getYesterdaysSummary(ss);
  const summaryText = generateGeminiSummary(
    todaysEntries,
    yesterdaysSummary
  );

  const sections = summaryText.split('\n\n');

  sheet.appendRow([
    today,
    newItemCount,
    sections[0] || '',
    sections[1] || '',
    sections[2] || '',
    new Date()
  ]);
}

/**
 * Checks whether a summary already exists for today.
 */
function summaryExistsForToday(sheet, today) {
  const dates = sheet
    .getRange(2, 1, Math.max(sheet.getLastRow() - 1, 0), 1)
    .getValues()
    .flat();

  return dates.includes(today);
}

/**
 * Updates the Last_Run sheet with the current timestamp.
 */
function updateLastRun(ss) {
  const sheet = ss.getSheetByName('Last_Run');
  sheet.getRange('B1').setValue(new Date());
}

/**
 * Creates a deterministic ID for an entry.
 */
function generateEntryId(title, url) {
  const raw = `${title}::${url}`;
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    raw,
    Utilities.Charset.UTF_8
  );

  return digest
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2))
    .join('');
}

/**
 * Removes HTML tags from text.
 */
function stripHtml(text) {
  if (!text) return '';
  return text.replace(/<[^>]*>/g, '').trim();
}

/**
 * Tests Gemini API connectivity.
 */
function testGeminiConnection() {
  const apiKey = PropertiesService
    .getScriptProperties()
    .getProperty('GEMINI_API_KEY');

  const response = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=' + apiKey,
    {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        contents: [
          {
            parts: [{ text: 'Say hello in one short sentence.' }]
          }
        ]
      }),
      muteHttpExceptions: true
    }
  );

  Logger.log('Status: ' + response.getResponseCode());
  Logger.log('Body: ' + response.getContentText());
}

/**
 * Lists available Gemini models.
 */
function listGeminiModels() {
  const apiKey = PropertiesService
    .getScriptProperties()
    .getProperty('GEMINI_API_KEY');
  const response = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1/models?key=' + apiKey,
    {
      muteHttpExceptions: true
    }
  );
  Logger.log('Status: ' + response.getResponseCode());
  Logger.log(response.getContentText());
}
