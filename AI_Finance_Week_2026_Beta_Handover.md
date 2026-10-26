# Handover — AI in Finance Week 2026 Fisher Investments beta

**Updated:** October 25, 2026  
**Project owner:** Aditya Nyati  
**Competition:** UTD JSOM Finance Lab / Jindal AI Week — “The Next Chapter: Put AI to Work for a Real Investment Firm”  
**Status:** Public-source beta is built and tested; not yet an AI-powered product or final competition submission.

## Executive summary

The initial idea was a wealth-management training chatbot based on a firm's historical decisions. The direction was narrowed to a **decision-replay trainer**: a junior records a market stance, evidence, and a falsifier before seeing a dated public commentary; then reviews the quality of their reasoning. Fisher Investments is now the target firm, as requested.

The current prototype includes three historical scenarios and public-source references. It uses **public editorial material as a comparison point only**. It does not contain Fisher's internal investment committee decisions, client data, private trade rationale, or proprietary research. No AI model, retrieval service, or backend is connected yet; self-review scoring is deterministic and transparent.

## Project origin and access notes

- The original project context and competition rules are in [Nyati_Aditya_AIFinance_Handover.md](Nyati_Aditya_AIFinance_Handover.md). It documents the wealth-management direction, the initial chatbot idea, the decision-replay recommendation, risks, required deliverables, and original open tasks.
- The Claude.ai share link supplied during this work displayed an hCaptcha/login page; the private Claude project itself was not retrieved. The beta was based on the handover file later supplied in chat and on the public sources listed below.
- No firm was contacted. No licensed Finance Lab exports, confidential records, or client data were used.

## Decisions made

1. **Target:** Fisher Investments, using public sources. The handover had already identified it as the preferred wealth-management candidate; the user then chose it as the project target.
2. **Product angle:** decision-replay training rather than a general Q&A chatbot. The prototype asks the trainee to write a stance, rationale, and falsifier before revealing a public view.
3. **Evidence boundary:** use public materials as proxies, not as a claim to reproduce Fisher's private culture or actual internal reasoning. Fisher's public explanation describes a top-down process that starts with macro analysis before security selection.[11]
4. **Scenarios selected:** March 2020 pandemic disruption, September 2022 CPI shock, and March 2023 regional-bank stress. Each Fisher comparison is a dated public article, not evidence of a private portfolio action.[1][2][3]
5. **Privacy posture:** the beta runs locally and does not send written responses to a server or model.

## Deliverables created

- [START_HERE.md](START_HERE.md) — launch instructions and folder map.
- [Beta/index.html](Beta/index.html) — interactive Decision Replay beta.
- [Beta/README.md](Beta/README.md) — operating instructions, feature summary, current limits, proposed next increment.
- [Beta/app-core.mjs](Beta/app-core.mjs) — reveal gate and self-review scoring functions.
- [Beta/app-core.test.mjs](Beta/app-core.test.mjs) — Node test suite.
- [Source_Documents/README.md](Source_Documents/README.md) — source manifest, local filenames, original URLs, and retrieval/completeness notes.
- `Source_Documents/Fisher_Investments/` — 18 source files, mixing original downloaded documents and clearly labeled text extractions/excerpts.
- `AI_Finance_Week_2026_Beta_and_Public_Sources.zip` — refreshed bundle of the project folder, including this handover. The refreshed archive contains 26 entries and passes Python's ZIP integrity check; rebuild it after any further file changes.

### Source set and retrieval status

| Source group | Local contents | Status / intended use |
|---|---|---|
| Fisher Form ADV and public process | Form ADV Part 2A PDF; extracted Form CRS and disclosure-page text; extracted public top-down process page | The Form ADV PDF was downloaded and validated as a PDF; its brochure date is February 11, 2026.[4][5][6][11] The CRS file is extracted text, not the original PDF.[5] |
| Fisher public commentary | Three dated article text snapshots for COVID stimulus, CPI, and regional banks | Extracted Markdown snapshots with original URLs; not original HTML. Use them as public editorial views, not internal decisions.[1][2][3] |
| Event documents | Congress.gov CARES Act, BLS August 2022 CPI, Federal Reserve BTFP, FDIC SVB, and FDIC Signature Bank text snapshots | Public government-source text extractions; use original linked records for authoritative review.[12][13][14][15][16] |
| SEC 13F filings | Q1 2020 primary XML; filing index; indexed holdings excerpt; Q4 2022 filing index and extracted primary/holdings text | Q1 2020 primary XML was downloaded and parsed. Q1 2020 covers the quarter ended March 31 and was filed April 28, after the March 27 case date.[7] Q4 2022 was filed February 3, 2023.[9] The SEC returned HTTP 403 for direct downloads of the large holdings tables and Q4 primary XML; the saved holdings files are excerpts, not full raw filings.[8][9][10] |

13F holdings are a delayed, partial snapshot and do not state decision rationale. Do not present them as a complete portfolio, a contemporaneous signal when filed later, or proof of why a decision was made. The source manifest gives exact filenames and links.

## Beta behavior

- Three selectable historical scenarios with source-linked context and a Fisher public-view reveal.
- Reveal is locked until the trainee enters a risk stance, a rationale, and what would change their mind.
- After reveal, four self-ratings cover evidence, expectations, alternatives, and uncertainty; the score maps the average 1–5 rating onto 0–100.
- The app does not grade whether a forecast matched the eventual market outcome.
- Only case ID, score, and save timestamp are stored in browser local storage. Typed rationale and falsifier stay in page memory and are not saved or transmitted.
- Local source links work when served from the project root. If opening `index.html` directly blocks JavaScript modules, use the `python -m http.server` command in `START_HERE.md`.

## Verification completed

- Test-first development: the initial unit-test run failed because `app-core.mjs` did not yet exist; the core functions were then implemented and tests rerun.
- `node --test Beta/app-core.test.mjs`: **3 passed, 0 failed**. `node --check Beta/app-core.mjs`: passed.
- Browser smoke test: all three cases loaded; the reveal stayed locked until the three required fields were filled; reveal and local score saving worked.
- Browser checks confirmed local source links for the source README, ADV PDF, and Q4 holdings excerpt returned HTTP 200.
- Visual check of the first viewport found no obvious clipping or hierarchy issues.
- The downloaded Form ADV file begins with `%PDF-`; the Q1 2020 primary filing parses as XML.
- The ZIP bundle contained 25 entries before this handover was created and passed `testzip()` with no corrupt entries. Rebuild it to include this new file.
- Both temporary local HTTP test servers were stopped. There is no active test server.

## Competition requirements and timing

The original handover records the competition's requirements; use that file as the source of truth. As recorded there, the submission deadline is **Monday, October 26, 2026 at 11:59 PM**; the final is Wednesday, October 28, 2:00–3:30 PM, with a 6-minute presentation and 4 minutes of Q&A. Required submission pieces are a video of 5 minutes or less in Aditya's own voice/on camera, a deliverable, and a one-page AI log; links go to OneDrive, must be shared view-only with `jsomfinlab@utdallas.edu`, tested, and submitted through the Microsoft Form.

The rules in the original handover also say to use public information and approved Finance Lab databases only, cite sources, label assumptions, avoid licensed/confidential data in public AI tools, not contact the firm, and not reuse prior PRISM materials. The beta created here uses no prior PRISM code. Treat this document as a work-status handover, not a substitute for rechecking the official case instructions.

## Remaining work — priority order

1. **Make the AI contribution real.** Add private/local model-assisted retrieval or another approved AI component over a curated public corpus. The current beta is only a workflow demo and will not by itself meet the rubric's “AI does core work” standard.
2. **Build point-in-time packets.** The three prompts are reconstructed teaching cases, not complete archives of everything knowable on the stated date. For each, timestamp the available evidence and keep all post-cutoff commentary/filings behind the reveal.
3. **Expand cautiously.** The initial handover proposed 5–10 scenarios; the beta currently has 3. Add more only if the source and time cutoffs can be validated.
4. **Run AI checks and document them.** At minimum test citation/attribution accuracy and a counterexample or edge case. Record task, tool choice, key prompts/inputs/outputs, checks, and what was accepted/changed/rejected in the required one-page AI log.
5. **Verify industry statistics before using them.** The handover flags rookie washout, ramp-up time, and heirs leaving over investment philosophy. Those figures were not independently verified during this beta build; confirm each against its original source before using in the pitch or cost model.
6. **Build the business case.** Model analyst ramp time, mentor time, washout cost, and possible client/asset-retention value. Label every assumption; do not present hypothetical numbers as real.
7. **Prepare risks and Q&A.** Address groupthink, privacy, compliance, hindsight/survivorship bias, regime change, public-versus-private source gaps, differentiation from Digital Ray/Morgan Stanley tools, and how success is measured.
8. **Finish the competition package.** Produce the one-page AI log and ≤5-minute own-voice video, upload the final deliverable to OneDrive, share view access with the Finance Lab, test links, and submit the form before the deadline.
9. **Refresh the ZIP** after updates so it contains this handover and every final file; re-run the archive integrity check.

## Sources

[1] https://www.fisherinvestments.com/en-us/insights/market-commentary/around-the-world-in-coronavirus-stimulus
[2] https://www.fisherinvestments.com/en-us/insights/market-commentary/our-take-on-tuesdays-sharp-swings-and-cpi
[3] https://www.fisherinvestments.com/en-us/insights/market-commentary/putting-the-regional-bank-scare-into-perspective
[4] https://www.fisherinvestments.com/en-us/disclosures/form-crs-and-form-adv
[5] https://www.fisherinvestments.com/en-us/-/media/project/fisherinvestments/fisherinvestments/document/na/general/forms/form-crs-02-12-2026-v2.ashx
[6] https://files.adviserinfo.sec.gov/IAPD/Content/Common/crd_iapd_Brochure.aspx?BRCHR_VRSN_ID=1008280
[7] https://www.sec.gov/Archives/edgar/data/850529/000085052920000005/0000850529-20-000005-index.htm
[8] https://www.sec.gov/Archives/edgar/data/850529/000085052920000005/2020Q113F.xml
[9] https://www.sec.gov/Archives/edgar/data/850529/000085052923000002/0000850529-23-000002-index.htm
[10] https://www.sec.gov/Archives/edgar/data/850529/000085052923000002/2022Q413F.xml
[11] https://www.fisherinvestments.com/en-us/institutional-investing/top-down-investment-process
[12] https://www.congress.gov/bill/116th-congress/house-bill/748
[13] https://www.bls.gov/news.release/archives/cpi_09132022.htm
[14] https://www.federalreserve.gov/newsevents/pressreleases/monetary20230312a.htm
[15] https://www.fdic.gov/news/press-releases/2023/pr23016.html
[16] https://www.fdic.gov/news/press-releases/2023/pr23018.html
