# Decision Replay — Fisher public-source beta

## Start
Serve the project folder over http (module scripts are blocked on `file://`), then open `Beta/`.
Python and Node are not installed on this PC, so use the PowerShell server:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:TEMP\aifw-serve.ps1" -Root "C:\Users\nyati\Documents\Ai in Finance Week 2026" -Port 8000
```

Then open `http://localhost:8000/Beta/` (or `http://localhost:8000/Beta/#ask` for the archive). Tests: `http://localhost:8000/Beta/run-tests.html`.

The page has two views, switched in the header:
- **Replay cases** — lock in a call on a historical moment, then compare with Fisher's dated public commentary and self-review.
- **Ask the archive** — retrieval-augmented generation (RAG) over a document library. Type a question; the page reconstructs the past thought process as a cited flow.

## Ask the archive: RAG architecture

```
 upload (PDF / saved web page / txt / md / pasted text)
        │  pdf.js text extraction · HTML article extraction · cleanText() strips menus and banners
        ▼
 library  = starter docs (corpus.js) + shared uploads (artifact db) or browser uploads (localStorage)
        │  chunkText(): ~900-character passages on paragraph and sentence boundaries
        ▼
 BM25 index  (buildIndex)          question ──► search(): top-k passages, labeled S1..Sk
        │                                       as-of date filter drops documents published later
        ▼
 buildFlowPrompt(): passages + fixed stage list + rules (cite labels, exact quotes, no outside facts)
        │
        ├─ Claude (claude.ai artifact runtime, `sample.json`) ──► JSON flow
        └─ no model available ──► extractiveFlow(): one quoted sentence per stage
        ▼
 validateFlow(): the checks that make it auditable
   1. citations must name a retrieved passage (invented labels are removed)
   2. each quote must appear word for word in a cited passage
   3. the claim's key terms must overlap the cited text
   → step status: Quote verified / Supported / Weak support / Unsupported
        ▼
 flow view: Trigger → Facts → Interpretation → Expectations → Alternatives → Stated view → Risks & falsifiers
            each step links to its passage; "Copy check record" exports the checks for the AI log
```

Files:
- `rag-core.mjs` — pure logic: cleaning, chunking, BM25, as-of filter, prompt, validation, extractive fallback.
- `rag-ui.mjs` — library, uploads, query window, result rendering, Claude/db wiring.
- `corpus.js` — generated starter library. Rebuild with `powershell -ExecutionPolicy Bypass -File tools/build-corpus.ps1`.
- `rag-core.test.mjs`, `app-core.test.mjs` — `node --test` files; `run-tests.html` runs them in a browser.

### Where the AI runs
- **Published on claude.ai** (artifact with `sample`, `db`, `user` capabilities): Claude writes the flow on the viewer's own Claude account, after a one-time consent. Uploads go to a shared library everyone with the link can search; adding needs Contributor access.
- **Local server**: no model is reachable, so the page uses extractive mode and keeps uploads in this browser only. The retrieval, as-of filter, and checks are identical.

### Starter library (7 documents, 48 passages)
CARES Act record, BLS August 2022 CPI release, FDIC SVB and Signature releases, Fed BTFP release, Fisher's top-down process page, Fisher Form CRS. **The three Fisher commentary articles are not included** (see source issues below); add them through the upload panel:
1. Open each article in a browser and save it as a web page (.html) or copy its text.
2. In *Ask the archive*, add it with its publish date (2020-03-27, 2022-09-13, 2023-03-16) and type *Firm commentary*.

## Source bundle issues found (Oct 25)
- `Source_Documents/Fisher_Investments/2020-03-27-fisher-stimulus.md` and `2022-09-13-fisher-cpi.md` contain SEC 13F holdings text, not the Fisher articles their names suggest.
- `2023-03-16-fisher-regional-banks.md` holds only the headline and site menus; the article body is missing.
- The replay-case "reveal" summaries were written without the article text in the bundle; check them against the live articles before presenting.

## Current limitations
- Retrieval is keyword-based (BM25), not semantic embeddings, so a question must share words with the passage. It is transparent and runs fully in the browser.
- Extractive mode sorts sentences into stages by keyword cues; treat its stage labels as rough.
- Lexical overlap and exact-quote matching catch invented quotes and citations, not subtle misreadings. A person still reads the cited passage.
- Public commentary is not evidence of internal decisions or trades. Firm-internal memos are the intended production input; any internal examples in a demo must be labeled hypothetical.
- Scanned PDFs need OCR before upload; one document is capped at 120,000 characters.
- No investment recommendation, account-specific guidance, or client-facing output is produced.
