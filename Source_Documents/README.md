# Fisher Investments public-source bundle

Prepared for the **AI in Finance Case Competition** beta prototype. The app uses public editorial commentary as a benchmark for comparing reasoning; it does not contain Fisher Investments' internal research, client records, investment committee decisions, or private trade rationale.

## Files in this folder

### Firm information and stated process
- `Fisher_Investments/Fisher_Form_ADV_Part_2A_2026-02-11.pdf` — downloaded SEC IAPD Form ADV Part 2A brochure; the first page identifies the brochure date as February 11, 2026.[6]
- `Fisher_Investments/Fisher_Form_CRS_2026_extracted.md` — text extraction of the Form CRS published through Fisher's document URL; not the original PDF file.[5]
- `Fisher_Investments/Fisher_disclosure_page.md` — Fisher page explaining Form ADV Parts 1–3 and linking to the SEC record.[4]
- `Fisher_Investments/fisher-public-top-down-process.md` — text extraction of Fisher's public explanation of its top-down process: macro analysis, portfolio themes, and then security selection.[11]

### Dated Fisher public commentary used in the replay cases
- `Fisher_Investments/2020-03-27-fisher-stimulus.md` — article published March 27, 2020; compares immediate pandemic disruption with potential later support from government measures.[1]
- `Fisher_Investments/2022-09-13-fisher-cpi.md` — article published September 13, 2022; discusses the August CPI release, sentiment, and avoiding extrapolation from noisy monthly readings.[2]
- `Fisher_Investments/2023-03-16-fisher-regional-banks.md` — article published March 16, 2023; presents Fisher's contemporaneous public view on regional-bank contagion fears.[3]

These `.md` files are web-extracted text snapshots with source URLs in their headers, not original Fisher HTML files. Fisher's site describes the content as the opinions/viewpoints of its editorial staff; do not attribute it to a private investment committee or present it as proof of actual trades.[1][2][3]

### Public event documents for the case prompts
- `Fisher_Investments/2020-cares-act-congress.md` — Congress.gov record for the CARES Act.[12]
- `Fisher_Investments/2022-09-13-bls-cpi-release.md` — archived BLS August 2022 CPI release.[13]
- `Fisher_Investments/2023-03-12-federal-reserve-btfp.md` — Federal Reserve release on the Bank Term Funding Program.[14]
- `Fisher_Investments/2023-03-10-fdic-svb-closure.md` — FDIC release concerning Silicon Valley Bank.[15]
- `Fisher_Investments/2023-03-12-fdic-signature-bridge-bank.md` — FDIC release concerning Signature Bank.[16]

These are extracted text snapshots with the original government URL in each header; use the linked original record for authoritative review.

### SEC 13F snapshots
- `Fisher_Investments/Fisher_13F_Q1_2020_primary.xml` — downloaded SEC primary 13F-HR filing document. It reports the quarter ended March 31, 2020 and was filed April 28, 2020; it is after the March 27 case date.[7]
- `Fisher_Investments/Fisher_13F_Q1_2020_SEC_index.md` — SEC filing-index text snapshot with filing metadata and document links.[7]
- `Fisher_Investments/Fisher_13F_Q1_2020_holdings_indexed_excerpt.txt` — indexed/extracted holdings text, not the original complete information-table XML.[8]
- `Fisher_Investments/Fisher_13F_Q4_2022_SEC_index.md` — SEC filing-index text snapshot for the quarter ended December 31, 2022; filed February 3, 2023.[9]
- `Fisher_Investments/Fisher_13F_Q4_2022_primary_extracted.md` — extracted text from the SEC primary document; not the original XML file.[9]
- `Fisher_Investments/Fisher_13F_Q4_2022_holdings_indexed_excerpt.txt` — indexed/extracted holdings text, not the original complete information-table XML.[10]

The SEC archive returned HTTP 403 for direct downloads of the two large information tables and the Q4 2022 primary XML in this environment. The saved holdings files are explicitly excerpts, not full raw filings. Their official SEC records remain linked above. Do not infer rationale from 13F holdings: they are lagged, partial, long-only snapshots and do not document the manager's decision process.[7][8][9][10]

## Research/copyright handling

- The beta quotes or paraphrases only short portions of public commentary and links to the original pages.
- Do not add licensed Finance Lab exports, paid research, books, confidential firm material, or client data to the prototype or public AI tools.
- Verify exact statistics and the current filings before presenting the competition deliverable. The dates and the source descriptions above are research notes, not independent investment analysis.

## Sources

[1] <https://www.fisherinvestments.com/en-us/insights/market-commentary/around-the-world-in-coronavirus-stimulus>
[2] <https://www.fisherinvestments.com/en-us/insights/market-commentary/our-take-on-tuesdays-sharp-swings-and-cpi>
[3] <https://www.fisherinvestments.com/en-us/insights/market-commentary/putting-the-regional-bank-scare-into-perspective>
[4] <https://www.fisherinvestments.com/en-us/disclosures/form-crs-and-form-adv>
[5] <https://www.fisherinvestments.com/en-us/-/media/project/fisherinvestments/fisherinvestments/document/na/general/forms/form-crs-02-12-2026-v2.ashx>
[6] <https://files.adviserinfo.sec.gov/IAPD/Content/Common/crd_iapd_Brochure.aspx?BRCHR_VRSN_ID=1008280>
[7] <https://www.sec.gov/Archives/edgar/data/850529/000085052920000005/0000850529-20-000005-index.htm>
[8] <https://www.sec.gov/Archives/edgar/data/850529/000085052920000005/2020Q113F.xml>
[9] <https://www.sec.gov/Archives/edgar/data/850529/000085052923000002/0000850529-23-000002-index.htm>
[10] <https://www.sec.gov/Archives/edgar/data/850529/000085052923000002/2022Q413F.xml>
[11] <https://www.fisherinvestments.com/en-us/institutional-investing/top-down-investment-process>
[12] <https://www.congress.gov/bill/116th-congress/house-bill/748>
[13] <https://www.bls.gov/news.release/archives/cpi_09132022.htm>
[14] <https://www.federalreserve.gov/newsevents/pressreleases/monetary20230312a.htm>
[15] <https://www.fdic.gov/news/press-releases/2023/pr23016.html>
[16] <https://www.fdic.gov/news/press-releases/2023/pr23018.html>
