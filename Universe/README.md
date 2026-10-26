# Data Universe: local public-data discovery dashboard

A dashboard that downloads public market datasets to this computer, turns them into a searchable "universe", trains the search ranking on an 80/20 split, and answers analyst questions with **at least 3 options, most relevant first**, each tied to its source.

## Start

No installs needed (PowerShell + `curl.exe`, both built into Windows).

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\nyati\Documents\Ai in Finance Week 2026\Universe\serve.ps1"
```

Open <http://localhost:8010/Universe/>. Internet access is needed for downloads and, once, for the PDF/Excel readers (pdf.js and SheetJS from cdnjs).

1. **Datasets:** click *Download* per dataset or *Download all*. Files land in `Universe\data\<dataset-id>\` with a `manifest.json` (source URLs, sizes, failures).
2. **Build & train:** *Build universe* parses everything into documents (`data\_index\docs.json`, `series.json`). *Train ranking* runs the 80/20 tuning and saves `data\_index\model.json`.
3. **Ask:** type a question. Without an API key you get ranked search results; with a Claude API key (Settings) a Claude agent searches the universe with tools and writes the options.

The sidebar lists **Ask first (01), then Datasets (02), then Build & train (03)**. The page opens on Ask once a universe is built; on first use it opens on Datasets, and you work through Datasets, then Build & train, then Ask.

Tests: <http://localhost:8010/Universe/run-tests.html> (29 tests of the core logic).

## Datasets (catalog.json)

| Dataset | Source | Contents |
|---|---|---|
| FRED rates & curve | St. Louis Fed | Fed funds, 2y/10y yields, 10y–2y, mortgage rate, HY spread |
| FRED inflation & jobs | St. Louis Fed | CPI, core CPI, core PCE, unemployment, payrolls, NBER recessions |
| FRED growth | St. Louis Fed | Real GDP, industrial production, sentiment, retail sales, housing starts |
| FRED markets | St. Louis Fed | S&P 500 (last ~10y), Nasdaq, broad dollar, USD/EUR, WTI oil |
| FRED India | St. Louis Fed | INR/USD, India CPI, call money rate, discount rate |
| Cboe VIX | Cboe | Daily VIX since 1990 |
| Fama-French factors | Kenneth French library | Mkt-RF, SMB, HML, RF, momentum since 1926 |
| Shiller data | Robert Shiller | S&P price, earnings, GS10, CAPE since 1871 (Yale file ends 2023) |
| Survey of Professional Forecasters | Philadelphia Fed | Median forecasts: unemployment, CPI, core CPI, T-bill, 10y |
| FOMC statements | Federal Reserve | Statement text, about the last five years |
| Berkshire letters | Berkshire Hathaway | Shareholder letters 2000–2025 |
| World Bank macro | World Bank | GDP growth, inflation, unemployment, current account for 8 economies |
| SEC 13F | SEC EDGAR | Last 4 quarterly holdings for Fisher Investments and Berkshire, with buys/sells (needs your SEC User-Agent) |
| **Fisher Investments public documents** (focus company) | fisherinvestments.com, SEC IAPD | 7 documents Fisher published: 3 dated commentary articles (Mar 2020, Sep 2022, Mar 2023), its top-down process, the disclosure page, Form CRS and Form ADV Part 2A (Feb 2026). Loaded from `Source_Documents\Fisher_Investments`; click *Load*. |
| Your documents | `Universe\my-docs` | Any PDF/TXT/MD/HTML/CSV you add; a file name starting `2024-03-15` sets the date |

The Fisher set is a curated "local" dataset: `catalog.json` lists each file with its title, publication date and source link (an `include` list), and `serve.ps1` loads only those files from a folder inside the project. Fisher's website refuses command-line downloads (HTTP 403), so the page texts were read in a browser and saved as text copies; the Form ADV PDF is the SEC's original. Documents are cited with their date, and the Fisher commentary is Fisher's editorial opinion, not its investment committee's view. Keep to short quotes with a citation.

To add more: edit `catalog.json` (FRED series ids, 13F managers by CIK, World Bank indicators), then download and rebuild. IMF DataMapper and AAII block automated downloads; bank outlooks (J.P. Morgan, Vanguard, BlackRock) should be saved by hand into `my-docs`.

## How "80/20 training" works

The agent's answers depend on finding the right sources first, so the ranking is what gets trained:

1. **Question set.** Up to 120 questions per document type are generated from the universe, each with a known correct source. Structured data gets templated analyst questions ("What happened to the 10-year Treasury yield in 2022?"). Text gets a pseudo-question made of the four most distinctive words in one passage.
2. **80/20 split** (seeded, reproducible). 80% train, 20% held out.
3. **Grid search on the 80%** over 256 ranking settings: BM25 `k1` and `b`, a title-match boost and a year-match boost. Objective: mean reciprocal rank.
4. **Neural re-ranker (stage 2, a machine-learning model) on the same 80%.** BM25 with the tuned settings proposes its top 30 candidates per question. A small neural network scores each (question, candidate) pair from 18 generic features: BM25 score and rank, how much of the question (idf-weighted) appears in the passage and in the title, year match or mismatch, recency, passage length, and the document type. Architecture: standardised inputs → one hidden layer of 12 tanh units plus a direct linear path → one score (258 weights). Loss: softmax cross-entropy over the candidates with the right source as the target (listwise learning to rank), Adam, L2 1e-4, seeded so runs are reproducible. A seeded 20% of the training questions is set aside to choose the number of epochs (checked every 20, up to 400); the network is then retrained on all training questions for that many. The test 20% is never touched. Written in plain JavaScript (`trainRanker`, `rerankHits` in `universe-core.mjs`); training takes about 2 minutes on this PC.
5. **Score on the 20%** with the default settings, the tuned BM25 settings and the re-ranker. The dashboard shows all three, by question type. Ask uses BM25 plus the re-ranker; clarifying questions stay on BM25 scores, because their thresholds were calibrated on those.

**Neural re-ranker, held-out 20% (81 questions), 26 Oct 2026:**

| | Default BM25 | Tuned BM25 | Neural re-ranker |
|---|---|---|---|
| Right source ranked #1 | 72.8% | 82.7% | **88.9%** |
| Right source in top 3 | 84.0% | 92.6% | **92.6%** |
| Mean reciprocal rank | 0.785 | 0.876 | **0.907** |

280 epochs, chosen on the validation slice (validation MRR 0.905). Training-set MRR is 0.922, close to the test 0.907, so it is not badly overfitted. The gain comes from country-comparison tables (ranked #1: 79% → 100%) and 13F filings; on letter and FOMC passages it is no better than tuned BM25 (64% ranked #1), and top-3 is unchanged.

**Bias found and removed.** A first version also had two question-shape features (whether the question names a year, its length). It scored the same on the test set, but on "What did the FOMC say about inflation in 2023?" it pushed every FOMC statement out of the top 5: the generated text questions never contain a year, so it had learned that a dated question never wants a letter or statement. Those two features were dropped (an experiment with four feature sets, same split); the FOMC May 2023 statement is back in the top 5 at no cost on the test set. Caveat that remains: the questions are auto-generated, so the network can still learn habits of the question generator. Real analyst questions are needed to confirm the gain.

Latest run (26 Oct 2026, after adding the Fisher documents; 407 questions including 13F, 326 train / 81 test, 3,487 documents, 6,109 passages): held-out *right source in top 3* went from 84% to 93%, *ranked #1* from 73% to 83%, mean reciprocal rank from 0.79 to 0.88. Chosen settings: k1 0.9, b 0.4, title boost 1, year boost 1. (Run before the Fisher documents: 77% to 91% top 3, 62% to 80% #1, k1 1.2, title boost 2. The untrained baseline moved because 4 of the questions are new.)

13F holdings were downloaded and checked on 25 Oct 2026: 4 quarters each for Fisher (about 1,037 positions, $336B as of 2026-06-30) and Berkshire (29 positions, $299B). Berkshire's total matches the raw filing.

**Latest first.** When a question gives no year, a manager's 13F quarters and a series' yearly sheets are listed newest to oldest, on the view that older data is already reflected in prices. Other sources keep their relevance order, and the relevance numbers still read top to bottom. Words like "recent", "latest", "now" or "current" also boost documents from the last two years. Letters and FOMC statements stay in relevance order, because the most relevant passage matters more than the newest one. The agent's prompt carries the same rule.

## Sidebar, nebula background, logo and reasoning trace

- **Sidebar**: the three steps (Datasets, Build & train, Ask) are a left sidebar with the logo on top, a live line under each step (`13 / 14 on disk`, `Indexed & tuned`), completion dots, and at the bottom the engine indicator, the theme switch and a **Motion** switch. On a phone it becomes a compact top bar.
- **Logo**: `logo-mark.svg` (a planet carrying a data constellation, with an orbit ring passing in front, in nebula violet, pink and teal; also the browser-tab icon) and `logo.svg` (mark plus name, for slides and documents).
- **Nebula background**: `nebula.mjs` draws drifting nebula clouds, twinkling stars and a slow "data constellation" of nodes with pulses travelling along the links. The panels in front are translucent glass tinted with the same colours, so the nebula shows through. Dark mode is a deep-space nebula; light mode is a pastel one. A drawing frame measured about 1.5 to 1.7 ms at 1024×768 and it runs at 24 frames a second, but the **Motion** switch (remembered) freezes it to one still frame, and it starts frozen when the system asks for reduced motion.
- **Reasoning trace** (Ask tab, under the answer): a tree of how the answer was reached: *Question → Scope → Search → the entries handed to the model → Model → Conclusion*, with the ranked options hanging off the search. It grows step by step while the answer is made. Entries are coloured by dataset; entries the conclusion cites have a bright line into the model and a `✓ [n]` tag (click to jump to that reference), and entries that were read but not cited are dashed. It also lists the search settings used, how many clarifying answers shaped the scope, the time, and a text version of the whole trace. The model's own reasoning notes (when the free model returns them) are kept in a collapsed box marked raw and unverified.
- **What the trace is, and is not**: it is a record of what the system did, built from real values, not a window into the model's mind. The ranked options come from the search, not the model, and the tree says so.
- A conclusion that cites nothing is now forced to **low confidence**, because nothing in it can be checked. The free open model cites inconsistently, so this shows up now and then; **Regenerate** takes another sample.

## Interface design (PRISM-grade UI)

Built to `data_universe_ui_upgrade_specification.md` (Editorial Quantitative / Institutional Telemetry). All styling lives in `index.html`; colours, fonts and spacing are tokens on `:root`, so a theme is one block of variables.

- **Themes**: *Editorial Quant Light* (default if the system is light) and *PRISM Dark Obsidian*. The toggle in the top bar follows the system setting on first visit and remembers your choice in the browser.
- **Fonts**: Newsreader (headings), Inter (interface), JetBrains Mono (every number, with tabular figures). They load from Google Fonts; offline, the page falls back to Georgia, system sans and Consolas.
- **Top bar**: completion dots on each step (data downloaded · universe built and tuned · a question asked), monospace step numbers, a pulsing *Local Engine · Public Data Only* indicator, and a `Local` chip.
- **Build & train (step 3 in the sidebar)**: a status pill (index status, last trained) in the header; Card A with a 3-column telemetry strip, ingestion pipelines with live document counts, and index size; Card B with the 80/20 split bar showing question counts, the four tuned parameters with their search ranges and winning values, and a live `n/256 evaluated` counter while training runs; a results panel with before/after delta bars, lift badges, a winning-weights banner and a button on to Ask (step 1). Click a metric to see it by document type (macro and market fact sheets, letters and statements, 13F filings).
- **Ask and Datasets (steps 1 and 2)** use the same tokens, header format (`Step 0N // …`) and status pill.
- **Phones**: one column, no sideways scroll; the results table restacks so each metric keeps its bar and badge.

Where the specification used placeholder figures, the page shows live ones: the version chip is just `Local` (there is no version number), index size is measured from the saved index, the winning weights come from the last training run, and lifts are in percentage points (`+18 pts`) rather than `%`. Additions beyond the spec: a World Bank pipeline row, an MRR row, a per-type breakdown flagged *indicative only* when it rests on fewer than 10 questions, and a manual dark/light toggle that is kept between visits.

## Clarifying questions (narrow the scope first)

With **ask clarifying questions** ticked (default), a broad question gets up to three quick questions before it is answered:

- **Which source?** when the top matches split across datasets (e.g. World Bank vs SPF forecasts vs Berkshire letters).
- **Which measure?** when they split across series, 13F managers or World Bank indicators.
- **Which period?** when the question names no year and the matches span several years (*Latest*, or the strongest years).

Each choice shows its share of the top matches and has an **Any** option. Choices are real filters (dataset, measure) or fold into the query (year, "recent"), so the answer and the conclusion come only from entries inside the scope. After each pick the remaining questions are rebuilt within the narrower scope, and when nothing is left to ask the answer appears by itself. **Skip, answer as asked** ignores them; **Change scope** on an answer reopens them. The chosen scope is shown on the answer, passed to the model's prompt, and included in **Copy**.

The questions come from the universe itself (`clarifyQuestions` in `universe-core.mjs`): instant, free and grounded, with no model call (the free model allows one reply every 30 s). A question is not asked when one choice already holds 75% or more of the match score, or when the best match beats the runner-up by 10% or more (the question is already specific). That 1.1 threshold was chosen on the training 80%.

**Measured effect** (`evaluateClarify`, 81 held-out practice questions; a simulated analyst picks the choice matching the right source, so this is an upper bound):

| | Without | With clarifying |
|---|---|---|
| Right source ranked #1 | 80% | **88%** |
| Right source in top 3 | 91% | **93%** |
| Mean reciprocal rank | 0.87 | **0.91** |

It asked on 37% of questions (1.2 questions on average), and the right choice was always among those offered. Specific yearly questions were asked only 4% of the time; the gains come from cross-country questions (#1: 65% → 100%) and letter/FOMC passages (top 3: 71% → 79%).

## Conclusions with a free open-source model (default)

Works out of the box: the default provider needs no key. Under **Settings → Conclusions: free open-source model** you can switch provider:

- **Pollinations** (default, no key): the open-weight GPT-OSS 20B (Apache 2.0) at `https://text.pollinations.ai/openai`, model `openai-fast`. Free tier allows one reply every 30 seconds per IP; the page waits out the limit and retries by itself. Identical requests are cached, so **Regenerate** sends a new seed. A saved key for another provider is never sent to this endpoint.
- **Groq**: Llama 3.3 70B, free tier with a key. Key at https://console.groq.com/keys.
- **OpenRouter**: models ending in `:free`. Key at https://openrouter.ai/settings/keys.
- **Custom**: any OpenAI-compatible endpoint, including a local Ollama at `http://localhost:11434/v1` on a stronger PC (this one has 3.8 GB of RAM, too little for a useful local model).

*Load list* fetches the provider's current models. How a question is answered: the trained ranking gathers the 10 most relevant entries (at most 2 per series, plus the best letter or FOMC passages). One call asks the open model for a 4–8 sentence conclusion that combines them, cites source numbers like [1] or [2, 5], and rates its confidence. Citations are mapped back to the passages and checked; numbers that don't match a source are removed and counted. The 5 ranked options follow as supporting evidence. Your question and those excerpts go to the provider you chose.

**Conclusion window.** On the Ask tab, the ranked options appear at once on the left and the conclusion fills a separate window on the right (above the options on a phone) when the model replies, typically 10–30 seconds. The window shows the model, a live progress line with elapsed time, the conclusion with clickable numbered references, the confidence label, time and tokens, and **Copy** (plain text with references, for the AI log) and **Regenerate** buttons. If the model fails, the window says why and offers **Try again**; the options are unaffected.

## Conclusions with Claude (optional, paid)

Set *Conclusions written by* to Claude and add a Claude API key. Each answer then opens with Claude's own conclusion, drawn from all the relevant entries it found. Before writing, the agent searches several angles: the direct measure, related indicators, forecasts against actuals, FOMC statements and letters, and other countries. Each claim cites its entries as numbered references; click a number to open the passage. A confidence label (high, medium or low) shows how well the entries agree. The ranked options follow as supporting evidence. Without a key, ranked search can only show excerpts, and the page says so.

## How answers stay grounded

- The agent's only tools are `search_universe`, `get_series` and `list_datasets`, all reading the local files. The system prompt forbids outside knowledge.
- Every option must cite ids returned by those tools. Any other citation is removed and counted on screen. An option with no valid citation is flagged and ranked below the cited ones.
- If Claude returns fewer than 3 options, the list is filled from the trained search ranking (labeled as such).
- Without an API key, ranked search returns the top documents with their most relevant sentences, at most 2 per time series so the options cover different angles.

## Files

- `serve.ps1`: localhost server. Static files, `/api/download` (curl.exe), `/api/save`, `/api/settings`, `/api/claude` (pass-through to the Messages API; the key stays server-side and `settings.json` is never served).
- `catalog.json`: the dataset list.
- `universe-core.mjs`: parsers, document builders, BM25 index, question generation, 80/20 split, grid search, agent tools and answer checks (pure functions).
- `universe-ui.mjs`, `index.html`: the dashboard.
- `universe-core.test.mjs`, `run-tests.html`: tests, run in the browser.
- `export-hosted.ps1`, `hosted/`: the read-only snapshot for the online copy (see below).

## Online copy (GitHub Pages)

A read-only copy runs at https://nyatiaditya299.github.io/data-universe/Universe/ so it opens on a phone or for anyone with the link.

- With no local server, the page reads `hosted/` (the built index, ranking and dataset list) instead of `data/`. Ranked options, citations, scopes and the reasoning trace work. Downloading, building, training, settings and **written conclusions** are switched off: Pollinations refuses calls made straight from a web page (bot check), so conclusions need a server, which GitHub Pages does not have.
- The 26 Berkshire Hathaway letters are left out (copyrighted full text), so the online universe has 3,461 documents instead of 3,487. The training scores shown were measured on the full local universe.
- `status.json` carries no settings: no email, no keys.
- To refresh it after a rebuild: run `export-hosted.ps1`, then upload `Universe/hosted/` again. Open `http://localhost:8010/Universe/?hosted` to preview the online copy locally.

## Limits

- Public data only. No firm's internal advice is included; `my-docs` is where anonymised internal notes would go later.
- 13F reports are delayed quarter-end snapshots of US long positions and give no reasons.
- The question set is synthetic, which makes it a fair test of *finding sources*, not of answer quality. Add real analyst questions with known answers before relying on it.
- Nothing here is investment advice.
