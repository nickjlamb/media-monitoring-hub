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
