# Data Universe

A local dashboard for **AI in Finance Week 2026**. It downloads public market datasets to your computer, builds a searchable "universe" from them, trains the search ranking 80/20, and answers analyst questions with a cited conclusion and at least three ranked options. Conclusions are written by a free hosted open-weight model (GPT-OSS 20B via Pollinations, no key needed); Groq, OpenRouter, a custom endpoint or Claude can be used instead.

Public data only. Nothing here is investment advice.

## Run it (Windows)

No installs are needed. PowerShell and `curl.exe` are built into Windows.

```powershell
powershell -ExecutionPolicy Bypass -File Universe\serve.ps1
```

Then open <http://localhost:8010/Universe/>. Tests run at <http://localhost:8010/Universe/run-tests.html>.

The first time, open **02 Datasets**, click **Download all**, then **03 Build & train** and build the universe and train the ranking, then ask questions in **01 Ask** (the sidebar lists Ask first). The downloaded data (`Universe/data/`) and your settings (`Universe/settings.json`) are not in this repository; the dashboard recreates them.

## What is where

| Path | What it is |
|---|---|
| `Universe/` | The dashboard: server (`serve.ps1`), logic (`universe-core.mjs`), interface (`index.html`, `universe-ui.mjs`), nebula background (`nebula.mjs`), logo, catalog of datasets, tests |
| `Universe/README.md` | Full technical documentation |
| `Data_Universe_Handover.md` | Project handover: what was built, results, open points |
| `Beta/` | The earlier Fisher decision-replay beta |
| `Source_Documents/` | Public Fisher Investments source documents used by the beta |
| `AI_Finance_Week_2026_Beta_Handover.md`, `Nyati_Aditya_AIFinance_Handover.md`, `START_HERE.md` | Competition handovers and a starting guide |

## Highlights

- 14 public datasets (FRED, Cboe VIX, Fama-French, Shiller, Survey of Professional Forecasters, FOMC statements, Berkshire letters, World Bank, SEC 13F).
- Search ranking tuned on 80% of auto-generated questions and scored on the held-out 20% (right source in the top 3: 91%, ranked first: 80%).
- Clarifying questions that narrow the scope before answering.
- A reasoning-trace tree showing how each answer was reached.
- Light and dark themes, a sidebar layout, and an animated nebula background.
