# AI in Finance Week — Beta starter

## Run the prototype

Open `Beta/index.html` in a browser. If module scripts are blocked for a local file, start a local server from a terminal:

```powershell
python -m http.server 8000 --directory "C:\Users\nyati\Documents\Ai in Finance Week 2026"
```

Then open <http://localhost:8000/Beta/>.

## Data Universe dashboard (public-data discovery agent)

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\nyati\Documents\Ai in Finance Week 2026\Universe\serve.ps1"
```

Then open <http://localhost:8010/Universe/>. Download datasets, build and train (80/20), then ask questions. Each answer gives at least 3 ranked, cited options. See `Universe/README.md`.

## Folder map
- `Universe/`: Data Universe dashboard. Public dataset downloader, local searchable universe, 80/20-trained ranking, Claude agent (optional API key).
- `Beta/` — interactive Fisher Investments decision-replay beta, test files, and usage notes.
- `Source_Documents/` — Fisher public commentary, Form ADV, SEC 13F references/excerpts, and dated government event documents. See its README for each file's provenance and whether it is a full download or an extracted text snapshot.
- `AI_Finance_Week_2026_Beta_Handover.md` — current project status, files, verification, blockers, and next steps.
- `Nyati_Aditya_AIFinance_Handover.md` — original handover and competition requirements.

## Important caveat
This is a public-source workflow demo, not a connected AI assistant or Fisher Investments internal simulator. The prototype currently performs a transparent self-review; no written answer is uploaded or sent to a model. Read the Beta README and the source-bundle README before using it in a submission.
