# Media Monitoring Hub

A Google Apps Script tool that aggregates media signals from multiple sources and generates structured, comparative daily summaries using Gemini.

## What it does

Media Monitoring Hub collects articles and videos from configured sources, deduplicates them, and produces a comparative daily summary. It runs once per day via a time-driven trigger and writes results to a Google Sheet.

The system is designed to prioritise structure and restraint over verbosity.

## Problem it solves

Communications and insights teams often need to track media coverage across multiple channels. Manual monitoring is time-consuming, inconsistent, and cognitively expensive.

This tool automates the collection and structured synthesis of coverage, surfacing dominant themes and emerging narratives without requiring constant attention.

## Data sources

- **RSS/Atom feeds**: Google Alerts, news sites, blogs, or any standard feed
- **YouTube Search API**: Video content matching configured search queries

Additional sources can be added by implementing new fetch functions.

## How Gemini is used

The script calls Gemini (`gemini-2.5-flash`) to generate a structured daily summary.

The prompt is designed to be grounded and conservative:

- Only analyzes items fetched that day
- Compares against yesterday's summary for continuity
- Explicitly states when no meaningful change is observed
- Does not speculate or invent trends

Responses follow an explicit output schema to ensure predictable formatting and minimise drift.

Output format:

- Dominant themes today
- Changes vs yesterday
- Emerging narratives to watch

## Why summaries only generate when new signal appears

Summaries are only created when `insertedCount > 0`. This prevents:

- Empty or redundant summaries on quiet days
- Unnecessary API calls to Gemini
- Noise in the `Daily_Summaries` sheet

If no new entries are found, the run completes without generating output.

## Architecture

```mermaid
flowchart TD
    A[Config Sheet<br/>Sources, Endpoints, Queries]
    B[fetchAllSources()<br/>RSS + YouTube API]
    C[storeNewEntries()<br/>SHA-256 Deduplication]
    D[generateDailySummary()<br/>Gemini API]
    E[Daily_Summaries Sheet]

    A --> B
    B --> C
    C -->|Only if new entries| D
    D --> E

The pipeline is idempotent: duplicate items are filtered using SHA-256 hashes, and summaries are generated only when new, non-duplicate signal is detected.

**Sheets required:**

- `Config`: Source definitions (name, enabled, endpoint type, query/URL)
- `Raw_Entries`: All fetched items with deduplication IDs
- `Daily_Summaries`: Generated summaries by date
- `Last_Run`: Timestamp of most recent execution

## Design principles

- Constrain model behaviour through explicit prompts and output schemas  
- Generate output only when new signal is detected  
- Prefer synthesis over summarisation  
- Augment editorial judgement rather than replace it  

## Setup

### 1. Create the Google Sheet

Create a new Google Sheet with the following sheets and headers:

**Config** (columns A-D):

| Source | Enabled | Endpoint | Query |
|--------|---------|----------|-------|
| Google Alerts - Topic | TRUE | RSS | https://www.google.com/alerts/feeds/... |
| YouTube | TRUE | API | your search query |

**Raw_Entries** (columns A-G):

| Fetched Date | Source | Title | Snippet | URL | Published Date | Entry ID |

**Daily_Summaries** (columns A-F):

| Date | New Items | Dominant Themes | Changes | Emerging Narratives | Generated At |

**Last_Run** (columns A-B):

| Last Run | (timestamp) |

### 2. Create the Apps Script project

1. In your Sheet, go to **Extensions > Apps Script**
2. Delete any default code
3. Paste the contents of `apps-script/main.gs`
4. Save the project

### 3. Configure API keys

1. In Apps Script, go to **Project Settings > Script Properties**
2. Add the following properties:
   - `GEMINI_API_KEY`: Your Google AI Studio API key
   - `YOUTUBE_API_KEY`: Your YouTube Data API v3 key (if using YouTube source)

### 4. Set up the daily trigger

1. In Apps Script, go to **Triggers** (clock icon)
2. Click **Add Trigger**
3. Configure:
   - Function: `runDailyMediaMonitoring`
   - Event source: Time-driven
   - Type: Day timer
   - Time: Select preferred hour

### 5. Test the setup

Run `testGeminiConnection()` from the Apps Script editor to verify API connectivity.

## Known limitations

- YouTube API has daily quota limits (10,000 units/day default)
- RSS feeds must be publicly accessible (no authentication)
- Gemini summaries are limited by the model's context window
- No retry logic or exponential backoff for transient API failures
- Single-threaded execution (Apps Script limitation)

## Future extensions

- Additional API sources (Reddit, X, news APIs)
- Configurable summary frequency (e.g. weekly rollups)
- Slack or email delivery of summaries
- Source-level error tracking and alerting
- Historical trend analysis across summaries
