# Next-session handover (written 26 Oct 2026)

**Read this first.** It replaces the long chat history. The detailed technical record is in `Data_Universe_Handover.md` and `Universe/README.md`; this file says where things stand, what is still open, and what will trip you up.

**Owner:** Aditya Nyati (MS Finance, UT Dallas). **Competition:** JSOM Finance Lab "The Next Chapter: Put AI to Work for a Real Investment Firm". **Focus company:** Fisher Investments.
**Deadline: Monday 26 Oct 2026, 11:59 PM** (late entries are not judged). Final, if selected: Wed 28 Oct 2:00–3:30 PM (6-minute presentation, 4 minutes Q&A); top 8 announced Tue 27 Oct 6:00 PM.

---

## 1. What exists

**The product: Data Universe** (`Universe/`). A local dashboard, no installs needed (Windows PowerShell + `curl.exe` only).

- Downloads **15 datasets** (14 on disk; the 15th is the empty `my-docs` folder) into a searchable "universe": **3,487 documents, 6,109 passages, 77 time series**.
  - FRED (5 sets), Cboe VIX, Fama-French, Shiller, Philly Fed SPF, FOMC statements, Berkshire letters, World Bank, SEC 13F (Fisher + Berkshire, 4 quarters each), and **Fisher Investments' own published documents** (3 dated commentary articles, top-down process page, disclosure page, Form CRS, Form ADV Part 2A).
- **Ranking** is BM25, tuned 80/20. Latest run: 407 auto-generated questions (326 train / 81 held out); right source in top 3 **84% → 93%**, ranked first **73% → 83%**, MRR **0.79 → 0.88**. Settings: k1 0.9, b 0.4, title boost 1, year boost 1. These scores test *finding the right source*, not answer quality.
- **Ask tab** (first in the sidebar): clarifying questions (source / measure / period) that narrow the scope; at least 3 ranked options; a **conclusion window** written by the free open model **GPT-OSS 20B via Pollinations** (no key; one reply per 30 s per IP; the page waits and retries); numbered citations that are validated against real passages; a **reasoning-trace tree** showing scope → search → entries → model → conclusion (it records what the system did, not the model's mind). An uncited conclusion is forced to "low confidence".
- **UI:** PRISM-style design, light and dark themes, left sidebar (**01 Ask, 02 Datasets, 03 Build & train**; page opens on Ask once a universe is built, otherwise on Datasets), animated nebula background with translucent glass panels (Motion switch in the sidebar), logo (`Universe/logo-mark.svg`, `Universe/logo.svg`).
- Tests: **27** browser-run unit tests. Open `http://localhost:8010/Universe/run-tests.html`; the title must read `PASS (27)`.

**Also in the project:** `Beta/` (the earlier Fisher "decision-replay" trainer; separate, no AI model), `Source_Documents/` (public Fisher/event documents), `tools/`, and the competition handovers in the project root.

**Submission pieces** (`Submission/`):

| File | State |
|---|---|
| `Nyati_Aditya_Fisher_AILog.pdf` (+ `.html` source) | Done. One page, 5 checks, matches the required elements. Regenerate the PDF after editing the HTML (see section 4). |
| `Nyati_Aditya_Fisher_VideoScript.md` | Done. 3-minute first-person script, about 433 spoken words. The owner must record it **in his own voice or on camera; no AI voice or avatar**. |
| `Nyati_Aditya_Fisher_Video` | **Not made** (the owner records it). |
| `Nyati_Aditya_Fisher_Deliverable` | **Not made. Decide what it is** (see section 3). |

---

## 2. Run it

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\nyati\Documents\Ai in Finance Week 2026\Universe\serve.ps1" -Port 8010
```

Or use the preview tool: `preview_start` with name `universe` (port 8010; `.claude/launch.json` also has `beta` on 8000 and `universe-alt` on 8011, which is stopped).

- **If port 8010 is "already registered":** a stale copy of `serve.ps1` is running. Find it with `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'serve.ps1' }`, stop only that PID, then start again. Do not touch the Beta server on 8000.
- **`serve.ps1` changes need a server restart.** Changes to `index.html` or `*.mjs` only need a page reload.
- Settings live in `Universe/settings.json` (contains the owner's email as the SEC User-Agent; API keys are empty; never commit this file). Default conclusion engine: Pollinations, no key.

---

## 3. What is still open (priority order for tonight)

1. **Record the video** (owner, own voice, ≤ 5 min; the script is built for about 3:00). Rehearse the demo first: the free model can take up to 30 s to answer. Good demo questions: "What is Fisher Investments' top-down investment process?", "What did the FOMC say about inflation in 2023?", "What is happening with inflation?" (shows the clarifying card).
2. **Decide the Deliverable** (any format is allowed). Options: a short document or deck describing the product, plus the GitHub link and/or the running dashboard; a zip of the project. Nothing named `Nyati_Aditya_Fisher_Deliverable` exists yet.
3. **Business value is the weakest rubric area.** There is no cost model or financial case (analyst ramp time, mentor time, washout cost, client retention) and no success metrics. The 3-minute script covers problem, product and limits but not quantified value. Industry statistics in the original handover (rookie washout 72%+, heirs leaving 38%, advisor shortage) were **never verified against original sources**; verify before using any, and label every assumption.
4. **Q&A prep** (for the final): groupthink, privacy and compliance (FINRA communications if shared with clients), hindsight and survivorship bias, regime change, public-vs-private data gap, differentiation from Digital Ray, Bridgewater AIA Labs and Morgan Stanley's assistant, how success is measured.
5. **Check the Beta's replay-case "reveal" summaries** (`Beta/index.html`, around lines 130–154) against the corrected Fisher article files; they were written without the article text.
6. **Refresh `AI_Finance_Week_2026_Beta_and_Public_Sources.zip`** if it will be submitted (it is stale and excluded from git by `.gitignore`).
7. **Push the latest local changes to GitHub** (section 4) and decide whether the repo stays private.
8. **Submit:** upload the video, deliverable and AI log to OneDrive, share view-only with `jsomfinlab@utdallas.edu`, test every link, submit through the Microsoft Form. File names must be `Nyati_Aditya_Fisher_Video`, `_Deliverable`, `_AILog`. The owner does this; do not enter credentials on his behalf.

**Rules to keep honoring:** public information only; cite sources and label assumptions; never present invented data as real; no licensed or confidential data in any public AI tool (the project sends only public data and public questions to Pollinations); do not contact the firm; individual entry; all work created between 25 Oct 10:00 AM and the deadline.

---

## 4. Tooling on this PC (and the traps)

The PC is weak (3.8 GB RAM, 2-core i3). **Not installed:** Python, Node, git, GitHub CLI. Shell is Windows PowerShell 5.1 (no `&&`, `??`).

- **GitHub:** repo `https://github.com/nyatiaditya299/data-universe` (private, owner account `nyatiaditya299`, 14 commits at last push). No git, so uploads go through the website in the owner's signed-in Chrome (Claude in Chrome extension): create a tab, open `https://github.com/nyatiaditya299/data-universe/upload/main/<folder>`, use `find` to get refs for the file input, commit summary and Commit button, `file_upload` the files, set the message, click Commit. Traps: the uploader **rejects dotfiles** (create `.gitignore` via `.../new/main?filename=.gitignore`); **wait for "Uploading N of M" to finish** before committing; refs change per page; each session needs its own tab group (`tabs_context_mcp` with `createIfEmpty`, then `tabs_create_mcp`).
- **Not yet pushed** (changed locally after the last push): `Universe/index.html`, `Universe/universe-ui.mjs`, `Universe/nebula.mjs`, `Universe/README.md`, root `README.md`, `Data_Universe_Handover.md`, `Submission/Nyati_Aditya_Fisher_VideoScript.md`, and this file.
- **AI log to PDF:** edit `Submission/Nyati_Aditya_Fisher_AILog.html`, then print with Edge headless: `msedge.exe --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="<out.pdf>" <file-uri>` (Edge is at `C:\Program Files (x86)\Microsoft\Edge\Application\`). Count pages by counting `/Type /Page` in the file; it **must stay at 1 page** (it is tight at 7.8 pt).
- **Fisher's website returns HTTP 403 to curl.** Read pages in the built-in browser (`get_page_text`) instead. The SEC IAPD Form ADV PDF downloads fine. The Fisher text copies are full copies of public pages: fine in a private repo, reconsider before making it public.
- **Browser pane quirks:** the preview pane can be "hidden", so animation frames and CSS transitions stall (a stuck mid-transition colour is not a bug); screenshots are cropped to 800 px wide.
- **The free model cites inconsistently** (about half of live runs skip citations). That is why uncited answers show "low confidence". It also sometimes says something is "not mentioned" when it was not among the 10 excerpts handed to it.

---

## 5. Design decisions already made (do not reopen without a reason)

- **Retrieval + cited conclusion, not fine-tuning** (the original plan said not to fine-tune).
- **Ranked options come from the search, not the model.** The model only writes the conclusion over the retrieved entries.
- **Free hosted open model by default** (owner chose this over a local model because this PC cannot run one); the Custom endpoint can point at a local Ollama (`http://localhost:11434/v1`) on a stronger machine. **The product's story:** in production it needs a locally hosted model for speed (no queue) and data protection, and the firm's internal advice data (which this prototype does not have) is where the real value would be.
- Clarifying questions come from the data itself (no model call), skipped when the question is already specific.
- Sidebar order is Ask, Datasets, Build & train (owner's request, 26 Oct).
- Fisher focus: the Fisher documents are one curated "local" dataset (`include` list in `Universe/catalog.json`, read from `Source_Documents/Fisher_Investments`; the Datasets button says *Load*).

## 6. Known limits (say these honestly in any pitch)

- No internal firm data: everything is a public proxy. 13F filings are delayed snapshots with no reasons.
- The practice-question scores measure retrieval of the right source, not answer quality. Add 30–50 real analyst questions with known answers before relying on them.
- Fisher's commentary is editorial opinion, not its investment committee's view; public writing is the polished version of reasoning.
- IMF DataMapper and AAII block automated downloads (HTTP 403); bank outlook PDFs have reuse terms, so they go in `Universe/my-docs` by hand.
- Nothing here is investment advice.

---

## 7. Working notes for the next assistant

- The owner gives short instructions and wants results in plain language, with honest caveats. State what was verified and what was not.
- After each change: verify in the browser (`preview_start`, `run-tests.html` = `PASS (27)`), then update `Universe/README.md` and `Data_Universe_Handover.md`.
- Keep the AI log truthful: it must reflect what was actually asked, produced and checked. If new checks are run, add them (and keep it to one page).
- Never put API keys, `settings.json`, or the downloaded `Universe/data/` folder into GitHub.
