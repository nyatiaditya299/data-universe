# Handover: Data Universe dashboard

**Updated:** 26 October 2026 (morning)
**Project owner:** Aditya Nyati
**Context:** AI in Finance Week 2026 competition. Per [AI_Finance_Week_2026_Beta_Handover.md](AI_Finance_Week_2026_Beta_Handover.md), the submission deadline is **Monday 26 October 2026, 11:59 PM**.
**Status:** working local dashboard. Conclusions now run **live with no key** on the free hosted open-weight model GPT-OSS 20B (via Pollinations) and appear in a dedicated conclusion window on the Ask tab. Verified with real questions on 26 Oct.

### 26 Oct update: Fisher Investments public documents added to the universe
- Asked by the owner: add the publicly available documents Fisher Investments posted to the searchable universe, since Fisher is the focus company.
- **Added** a "Focus company: Fisher Investments" dataset (first in the Datasets tab): 3 dated commentary articles (2020-03-27 stimulus, 2022-09-13 CPI, 2023-03-16 regional banks), the top-down investment process page, the Form CRS/ADV disclosure page, Form CRS (2026-02-11) and Form ADV Part 2A (2026-02-11, the SEC PDF). Each has its real title, date and source link. Universe is now **3,487 documents, 6,109 passages**. The 13F holdings for Fisher were already in the universe and are unchanged.
- **Source files were wrong and are now fixed.** `2020-03-27-fisher-stimulus.md` and `2022-09-13-fisher-cpi.md` actually held SEC 13F holdings text, `Fisher_disclosure_page.md` an EDGAR filing page, and the regional-banks and process files only site menus. Fisher's website returns HTTP 403 to command-line downloads, so I read the five real pages in a browser and rewrote the files (text only; tables, charts and bullet lists on the pages are not captured). The Beta README had flagged the first three; it is updated.
- **How it works**: a curated "local" dataset (`include` list in `catalog.json`, loaded by `serve.ps1` from `Source_Documents/Fisher_Investments`; the button says *Load*). The server must be restarted to pick up the new `serve.ps1`.
- **Checks**: scan found 7 of 7 files; every Fisher question I tried ranks the right document first (top-down process, regional banks, CPI, advisory fees, COVID stimulus), and the existing questions (13F buys and sells, FOMC, CAPE, Buffett) are unchanged. "What is Fisher Investments' top-down investment process?" gave a conclusion citing the process page (medium confidence). Retrained: right source in top 3 **84% → 93%**, first **73% → 83%** on 81 held-out questions. 27 tests pass.
- **Still open**: the Beta's replay-case "reveal" summaries (in `Beta/index.html`) were written without the article text; check them against the corrected files. The GitHub repository still has the old, wrong files until the changes are pushed. The AI log and video script were updated to the new figures.
- **Copyright note**: these are full text copies of Fisher's public pages. Fine for local research in a private repository; before making the repository public, consider keeping only the links and short excerpts.

### 26 Oct update: sidebar, nebula background, logo, reasoning-trace tree
- Asked by the owner: (1) a graphical thinking tree on the Ask tab showing how the model approached the answer; (2) Datasets, Build and Ask as a sidebar; (3) a dynamic visual background on the theme of "data universe", with nebula colours reflected in slightly transparent front panels; (4) a logo in place of the plain name.
- **Done**: new files `nebula.mjs`, `logo-mark.svg`, `logo.svg`; `index.html` and `universe-ui.mjs` changed. See the README section "Sidebar, nebula background, logo and reasoning trace".
- **The tree shows what the system did, not the model's mind**: scope (with clarifying answers), the trained search and its settings, the 10 entries handed to the model, which of them the conclusion cites (click to jump), the model, and the conclusion; ranked options branch off the search. Built from real values, grows while the answer is made, has a text version and a collapsed raw box for the model's own notes (marked unverified). Stated on the page so nobody over-reads it.
- **Change to confidence**: an uncited conclusion is forced to **low** (closes the "high confidence with no citations" quirk noted earlier). New test; **27 tests pass**.
- **Verified**: light, dark and a 375 px phone; sidebar collapses to a top bar; no sideways scroll on any tab; the tree grows stage by stage, shows a pulsing model node while writing, Regenerate resets and regrows it, cited entries highlight, click jumps to the reference; Motion switch toggles and is remembered; drawing cost about 1.6 ms a frame.
- **Observed and not fixed**: the free GPT-OSS model sometimes omits citations (two of five runs today), so those answers now correctly read "low confidence" and the tree shows 0 cited. An automatic retry would cost another 30 s on the free tier; not added.
- **Weak PC**: if the animation or the glass blur feels heavy, use the **Motion** switch. The page also respects the system "reduce motion" setting.

### 26 Oct update: PRISM-grade UI redesign
- Asked by the owner: redesign the dashboard UI to `data_universe_ui_upgrade_specification.md` (in Downloads), filling in whatever the spec leaves out.
- **Done** across all three steps, not only Step 2: design tokens and a **dark/light theme toggle** (remembered), Newsreader / Inter / JetBrains Mono, completion dots and a pulsing "Local Engine" indicator in the top bar, and `Step 0N // …` headers with a status pill. Step 2 now has the telemetry strip, ingestion-pipeline rows with live counts, the 80/20 split bar, the 4-parameter grid with ranges and winners, a live `n/256 evaluated` counter, delta bars with before-pins and lift badges, the winning-weights banner, per-document-type drill-down on each metric, and the "Proceed to 3 · Ask" buttons.
- **Live data instead of the spec's placeholders**: no fabricated `v2.4` (chip says `Local`), index size measured (~6.5 MB), winning weights real (k1 1.2, b 0.4, title 2, year 1), and lifts shown as points (`+18 pts` Recall@1, `+14 pts` Recall@3, `+0.17` MRR).
- **Verified in the browser**: light, dark and a 375 px phone on all three tabs with no sideways scroll; a real training run fills the counter (40/256 → 88/256 → 256/256) and reproduces the same model; the theme persists; 26 tests still pass. Only `index.html` and the Step 2 / navigation / theme code in `universe-ui.mjs` changed; the ranking, clarifying questions and conclusion logic are untouched.
- Watch-outs: fonts come from Google Fonts, so offline the page falls back to system fonts. The 13F row of the breakdown (4 questions, 0% → 100%) is flagged "indicative only". The conclusion window can still show "high confidence" on an answer whose citations were all dropped (the red "treat it as unverified" note shows); worth tightening to "low" if time allows.

### 26 Oct update: clarifying questions
- Asked by the owner: the chatbot should ask clarifying questions to narrow the scope and make answers more precise.
- **How it works**: on Ask, a broad question gets up to 3 quick questions (**which source / which measure / which period**) built from where its top 30 matches spread out. Each choice shows its share of the matches, plus **Any**. Picks become real filters (dataset, series/manager/indicator) or fold into the query (year, "recent"). The remaining questions are rebuilt after each pick, and the answer appears by itself when nothing is left. **Skip** and **Change scope** are available; the scope is shown on the answer, sent to the model and included in **Copy**. Checkbox: *ask clarifying questions* (on by default).
- **No model call**: it's instant and grounded in the universe, which matters because the free model allows one reply every 30 s.
- **Skips specific questions**: no question when one choice holds ≥75% of the match score, or when the best match beats the runner-up by ≥10% (threshold chosen on the training 80%).
- **Measured on the 81 held-out questions** (simulated analyst picks the matching choice, so this is an upper bound): ranked #1 **80% → 88%**, top 3 **91% → 93%**, MRR **0.87 → 0.91**. It asked on 37% of questions (1.2 on average) and always offered the right choice. Biggest gains: cross-country questions (#1 65% → 100%) and letter/FOMC passages (top 3 71% → 79%). Specific yearly questions are asked only 4% of the time.
- Also fixed: choosing one measure lifts the "2 per series" cap, so answers still show 5 options. **26 tests passing.**
- Verified in the browser: "What is happening with inflation?" → Source (World Bank 39% / SPF 32% / Berkshire 18%) and Period → picked SPF → Measure question within SPF → picked "CPI four quarters ahead" → 5 options and a high-confidence conclusion framed as forecasts. "How did the VIX behave in 2020?" answers directly.
- Watch-out: on vague questions the choices reflect what the ranking finds. "How did interest rates behave?" offers Berkshire letters and Shiller but not the FRED rates dataset, which shows a ranking gap for that wording.

### 26 Oct update: conclusion window on a free hosted open model
- **Default provider is now Pollinations** (`https://text.pollinations.ai/openai`, model `openai-fast` = GPT-OSS 20B, Apache 2.0). No key or account needed. Limit: one reply every 30 s per IP; the page counts down and retries automatically. Groq, OpenRouter and Custom still work with a key.
- **Conclusion window**: ranked options show instantly on the left; the conclusion fills a sticky window on the right (stacked on top on phones) with progress and elapsed time, numbered references, confidence, time and tokens, **Copy** (text + references for the AI log), **Regenerate** (new seed, since Pollinations caches identical requests) and **Try again** on errors.
- **Ranking fix**: the FOMC press-office tail ("For media inquiries… Implementation Note issued May 3, 2023") is cut before passages are split. Its date token had outranked the real statements, so "What did the FOMC say about inflation in 2023?" got only boilerplate. It now gets the May/Jun/Jul/Sep 2023 statements. New test added (**23 passing**). Ranking retrained afterwards (see section 6): held-out top 3 now 91%, #1 now 80%.
- **Live results**: "Is the Shiller CAPE high compared with history?" → high-confidence conclusion in 25 s, figures (30.81 vs 17.40 average, 95th percentile, 44.20 peak in Dec 1999) match the cited sheet exactly. FOMC 2023 inflation → high confidence, 4 valid citations. Watch-out: the 20B model sometimes claims something is "not mentioned" when it just wasn't among the 10 excerpts.
- **Restart the server** on port 8010 to pick up the new proxy code (the copy started in the earlier session runs the old code). A second launch entry `universe-alt` (port 8011) was added to `.claude/launch.json` for testing.

---

## 1. What was asked, in order

1. A step-by-step guide to building an AI bot over a firm's past investment decisions, plus public datasets for a searchable universe. Answered in chat.
2. Refocus on a **wealth-management firm**: the bot should surface past advice from senior analysts and MDs so juniors can build their own market outlook. Answered in chat (PII anonymisation, advice log with outcomes, point-in-time data, public outlook sources).
3. **Build a dashboard** that queries and downloads those public datasets to this computer. A backend agent works only on that limited universe, is **trained 80/20**, and gives **at least 3 options in descending relevance**. Built.
4. Set the SEC User-Agent to the owner's email, then download and test **13F holdings**. Done.
5. Undated questions should list results **latest to earliest** (past data is already in prices). Done.
6. The agent should **draw a conclusion** from all relevant entries, not just show excerpts. Done (Claude version).
7. Run conclusions on a **free open-source model** instead of a Claude key. Owner chose a **free hosted open model** over a local one. Done (Groq / OpenRouter / custom).
8. Build the **conclusion window** on a free hosted open model. Done (Pollinations, GPT-OSS 20B, no key).
9. The chatbot should **ask clarifying questions** to narrow the scope and make answers more precise. Done (see the 26 Oct update).
10. Redesign the **UI** to the PRISM-grade specification. Done (see the 26 Oct update); next: take screenshots of both themes for the deliverable.
11. Sidebar navigation, nebula background with glass panels, a logo, and a **reasoning-trace tree** on the Ask tab. Done (see the 26 Oct update).
12. Add the publicly available documents Fisher Investments posted to the searchable universe (focus company). Done (see the 26 Oct update); the source files were found wrong and fixed.

## 2. How to run it

No installs needed: PowerShell and `curl.exe` are built into Windows. Python and Node are **not** installed on this PC.

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\nyati\Documents\Ai in Finance Week 2026\Universe\serve.ps1"
```

- Dashboard: **http://localhost:8010/Universe/** (works on this computer only, while the server runs)
- Tests: http://localhost:8010/Universe/run-tests.html (**22 passing**)
- Also registered as the `universe` entry in `.claude/launch.json`.

Sidebar order (changed 26 Oct at the owner's request): **01 Ask**, **02 Datasets** (download, settings), **03 Build & train**. The first-time workflow is still Datasets → Build & train → Ask. The page opens on Ask once a universe is built, otherwise on Datasets.

## 3. To finish setup (owner action)

1. Get a free key at **https://console.groq.com/keys** (no card needed).
2. Dashboard → Datasets → Settings → *Conclusions: free open-source model*. Provider Groq, paste the key, **Save**. Optionally click **Load list** to pick a current model; the default is `llama-3.3-70b-versatile`.
3. Ask a question. The answer should open with a **Conclusion** box (numbered references, confidence label), followed by 5 ranked options.
4. If the default model name has been retired, use **Load list** and pick another.

## 4. What exists on disk

```
Universe/
  serve.ps1               localhost server: static files, /api/download (curl.exe), /api/save, /api/settings,
                          /api/claude (Anthropic proxy), /api/llm + /api/llm-models (OpenAI-compatible proxy)
  catalog.json            the 14 datasets (edit to add FRED series, 13F managers by CIK, World Bank indicators)
  universe-core.mjs       pure logic: parsers, fact-sheet builders, BM25 index, latest-first, question set,
                          80/20 split, grid search, agent tools, conclusion prompts, citation checks
  universe-ui.mjs         dashboard logic (pdf.js + SheetJS loaded from cdnjs on first build)
  nebula.mjs              animated nebula + data-constellation background (canvas)
  logo-mark.svg, logo.svg the Data Universe logo (mark only, and mark + name)
  index.html              dashboard page and styles (palette matches the Beta)
  universe-core.test.mjs  22 tests; run-tests.html runs them in the browser
  README.md               full technical documentation
  settings.json           local settings and keys (never served to the page; see section 7)
  my-docs/                drop your own PDFs/notes here, then "Scan folder"
  data/<dataset-id>/      downloaded raw files + manifest.json (URLs, sizes, failures)
  data/_index/            docs.json, series.json (built universe), model.json (trained ranking)
```

`START_HERE.md` was updated to point to the dashboard.

## 5. The universe (downloaded 25 Oct 2026)

| Dataset | Status |
|---|---|
| FRED: rates & curve, inflation & jobs, growth, markets, India (26 series) | ✅ |
| Cboe VIX daily | ✅ |
| Fama-French factors + momentum | ✅ |
| Shiller (S&P price, earnings, GS10, CAPE) | ✅ (Yale's file ends Sep 2023) |
| Philly Fed Survey of Professional Forecasters (unemployment, CPI, core CPI, T-bill, 10y) | ✅ |
| FOMC statements (47, about the last 5 years) | ✅ |
| Berkshire letters 2000–2025 (26 PDFs) | ✅ |
| World Bank macro (8 economies × 4 indicators) | ✅ |
| SEC 13F, Fisher Investments + Berkshire, last 4 quarters | ✅ verified: Berkshire Q2 2026 total of $299.25B matches the raw filing; Fisher ≈1,037 positions, $335.8B |
| **Fisher Investments public documents** (focus company) | ✅ 7 documents: 3 dated commentary articles, top-down process, disclosure page, Form CRS, Form ADV Part 2A (read from `Source_Documents/Fisher_Investments`) |
| Your documents (`my-docs`) | empty |
| IMF DataMapper, AAII sentiment | ❌ block automated downloads (HTTP 403) |
| Bank outlooks (JPM, Vanguard, BlackRock) | save by hand into `my-docs` (URLs change; reuse terms) |

Built universe: **3,487 documents, 6,109 passages, 77 time series** (3,480 documents and 5,984 passages before the Fisher documents were added on 26 Oct).

## 6. How it works

**Documents.** Each time series becomes an overview sheet (coverage, latest, high/low, long-run average and percentile) plus one fact sheet per year. World Bank data becomes cross-country year tables. Letters and FOMC statements are split into passages. Each 13F filing becomes a holdings summary plus a quarter-over-quarter "buys and sells" summary, with share classes named.

**Ranking.** BM25 with four tuned settings: k1, b, a title boost and a year boost. Additional rules:
- At most 2 options per series, so answers cover different angles.
- Undated questions list 13F quarters and yearly series sheets **newest first**. Letters and FOMC statements keep relevance order on purpose.
- Words like "recent", "latest" or "now" boost the last two years.

**80/20 training** (Build & train tab):
1. Generate up to 120 questions per document type, each with a known correct source. Templates are used for structured data; text uses four distinctive words from one passage.
2. Seeded 80/20 split.
3. Grid search over 256 settings on the 80%.
4. Score on the held-out 20%.

Latest run (26 Oct 2026, after adding the Fisher documents): 407 questions (326 train / 81 test), 256 settings tried. On the held-out 20%:

| Measure | Before training | After training | Previous run (25 Oct) |
|---|---|---|---|
| Right source in top 3 | 84% | **93%** | 91% (77% untrained) |
| Ranked #1 | 73% | **83%** | 80% (62% untrained) |
| Mean reciprocal rank | 0.79 | **0.88** | 0.87 (0.70 untrained) |

Chosen settings: k1 0.9, b 0.4, title boost 1, year boost 1 (previously k1 1.2, title boost 2). Train-set top 3 is 91%, close to the test score, so no sign of overfitting. The "previous run" column is the run before the Fisher documents; the untrained baseline moved because 4 of the questions are new.

By question type (held-out top 3, before → after): macro and market fact sheets (64 questions) 86% → 94%; letters and statements, including the Fisher documents (14 questions) 86% → 86%; 13F filings (3 questions, indicative only) 33% → 100%. Tuning helps the structured data most and does not improve the text documents.

After retraining, the FOMC 2023 inflation and Shiller CAPE questions still retrieve the right sources.

**Answer modes** (the "write a conclusion" checkbox on the Ask tab):

| Mode | When | What happens |
|---|---|---|
| Ranked search | no key | Top 5 documents with their most relevant sentences; a box explains a key is needed for a conclusion |
| **Open model** (default engine) | free key for Groq, OpenRouter or a custom endpoint | Trained ranking gathers 10 entries → one call writes a 4–8 sentence conclusion citing [1], [2, 5] → numbers mapped back to passages and checked → 5 ranked options below |
| Claude agent (optional, paid) | Claude key + engine set to Claude | Tool-using agent (search_universe, get_series, list_datasets) on `claude-opus-5-5`, effort high, server-side fallback on; writes a conclusion plus 3+ options |

In every mode, citations that don't match a real passage are removed and counted on screen, and options are padded to at least 3 from the ranking.

## 7. Settings and secrets (current state)

`Universe\settings.json`:

| Setting | Value |
|---|---|
| `secUserAgent` | `Aditya Nyati nyatiaditya112@gmail.com` (owner approved; sent only to sec.gov) |
| `anthropicApiKey` | empty |
| `llmApiKey` | empty |
| engine, endpoint, model | defaults (open model, Groq, `llama-3.3-70b-versatile`) |

The server refuses to serve `settings.json`, so the page never sees keys. Placeholder keys used during simulated tests were removed.

## 8. Verification done

- 22 browser-run unit tests pass: parsers, fact sheets, 13F diffs, share classes, ranking, latest-first, "recent" boost, 80/20 split, training, citation checks, open-model citation mapping.
- Every dataset was downloaded through the dashboard. Failures are recorded in each `manifest.json`; none at last run.
- Build and training ran end to end in the dashboard.
- Simulated runs (fake API responses) of both the Claude agent and the open model: the conclusion, references, confidence label, removal of a made-up citation, and padding to 3+ options all rendered correctly.
- Live check: the server reached Groq, which correctly answered "Invalid API Key" to a placeholder key.
- **Not yet done:** a real conclusion from a real model (needs the owner's free key).

## 9. Known limits

- Public data only. No firm's internal advice is included; `my-docs` is the slot for anonymised notes later.
- The practice-question set is synthetic. It measures *finding the right source*, not answer quality. Add 30–50 real analyst questions with known answers before relying on the scores.
- 13F reports are delayed quarter-end snapshots of US long positions, with no reasons given.
- With the open model, the question and up to 10 excerpts go to the chosen provider (Groq by default).
- This PC (3.8 GB RAM, 2-core i3, 2 GB MX230) is too weak for a useful local model. A stronger PC can point the **Custom** endpoint at Ollama (`http://localhost:11434/v1`).
- One strong 2014 Buffett passage still outranks the 2026 13F summaries for "What did Berkshire buy and sell recently?".
- Training takes about 2–3 minutes when the browser tab is in the background, and less when it's visible.
- Nothing here is investment advice.

## 10. Suggested next steps (priority order for the deadline)

1. **Run 3–5 real questions** (no key needed now) and use **Copy** in the conclusion window to record outputs and citations for the required one-page AI log.
2. Take screenshots: the datasets tab, the training results table and an answer with a conclusion. Use them for the deliverable and video.
3. Decide how this connects to the Fisher decision-replay Beta (`Beta/`). For example, use the universe as the "evidence locker" for replay cases, or add the Fisher commentary snapshots to `my-docs`.
4. Optional: add real analyst questions to the evaluation, more 13F managers in `catalog.json`, and saved bank outlooks in `my-docs`.
5. Rebuild the project ZIP so it includes `Universe/` and this handover. Leave out `Universe\settings.json` if it holds a key.
