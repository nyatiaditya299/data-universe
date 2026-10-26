# Handover: AI in Finance Case Competition (UTD JSOM, Fall 2026)

**Owner:** Aditya Nyati (MS Finance, UT Dallas)
**Session date:** Sun Oct 25, 2026
**Stage:** Ideation and feasibility only. Nothing has been built yet, and the firm hasn't been chosen.

---

## 1. Competition essentials

**Event:** JSOM Finance Lab, "The Next Chapter: Put AI to Work for a Real Investment Firm" (Jindal AI Week)

**Timeline**
| Milestone | When |
|---|---|
| Case released | Sun Oct 25, 10:00 AM |
| **Submission due** | **Mon Oct 26, 11:59 PM** (late entries are not judged) |
| Top 8 announced | Tue Oct 27, 6:00 PM |
| Final (in person, JSOM 11.101) | Wed Oct 28, 2:00–3:30 PM. 6-minute presentation, then 4 minutes of Q&A |

**The question:** How can a real firm use AI to create more value for itself and its clients?
- Focus areas: (a) trading and market research, or (b) **wealth management** (chosen direction)
- Any real firm is allowed. The choice of firm doesn't affect the score.
- Any format is allowed (app, chatbot, code, dashboard, report, proposal).

**The entry must show:** (1) the firm and its problem, (2) the idea and what makes it new, (3) the value and who benefits financially, (4) the work and how AI is used, (5) limits, risks, assumptions and success metrics. One well-supported idea beats several thin ones.

**Deliverables (all required)**
- **Video:** 5 minutes or less. Aditya must appear on camera or narrate in his own voice. No AI avatar or cloned voice.
- **Deliverable:** any format. A live link can also be added.
- **AI log:** one-page PDF. Must cover the task, the tool and why it was chosen, key prompts with inputs and outputs, **at least two checks** (comparing with a source, recalculating, testing an edge case), and what was accepted, changed or rejected.
- Upload to OneDrive, submit the links through the Microsoft Form, and **share with jsomfinlab@utdallas.edu (view access)**. Test every link.
- File names: `Nyati_Aditya_<Firm>_Video`, `_Deliverable`, `_AILog`

**Rules**
- Individual entry. AI tools are allowed, but help from other people isn't.
- **All work must be created between the case release and the deadline.** Prior PRISM code or materials can't be reused, though the know-how is fine.
- Use public information and Finance Lab databases only (Bloomberg, LSEG, Capital IQ, FactSet). Cite sources and label assumptions. Don't contact the firm.
- **Don't paste licensed or confidential data, including raw Finance Lab exports, into public AI tools.**
- Never present invented data as real. Hypothetical data is fine if labeled.
- No accusations against real firms or people.
- Plagiarism, invented data or breaking the AI rules leads to disqualification. Follow UTD policy UTDSP5017.

**Rubric:** five categories at 20 points each
1. **AI Deployment:** AI does core work, the tool works, output is checked, and errors, privacy and bias are addressed.
2. **Analysis & Evidence:** sourced data, sound methods, stated limits.
3. **Business Value & Feasibility:** clear user and need, financial logic, a realistic plan, fit with the firm.
4. **Innovation & Creativity:** an original idea or use of AI, plus a bold roadmap.
5. **Presentation & Deliverable:** a clear, well-paced video and deliverable, and strong Q&A answers. Going over time drops this to "Weak."

AI used only for scripts, slides or visuals counts as partial. Core tasks include models, screening and summarizing, firm research and working prototypes.

---

## 2. Aditya's idea

A chatbot for a wealth advisory firm, built on the firm's past deals and decision-making process. New hires use it to form market views informed by how their MDs and VPs decided in the past.

**Claimed benefits:** (1) it passes the firm's culture and philosophy to new hires, and (2) it helps analysts and associates develop mature thinking on markets, business development and client relations faster than learning by experience alone.

---

## 3. Feasibility findings

**Verdict:** Feasible, with two changes.

**Change 1: the data.** Internal deal and decision data isn't public, so it can't be used. Instead, build the prototype on a firm whose philosophy and decisions are publicly documented, and pitch deployment on the firm's internal data as the next step.

**Change 2: what makes it new.** Similar products already exist:
- **Digital Ray (Ray Dalio):** a chatbot trained on his principles and decision criteria recorded over about 35 years. A text beta, then a voice beta announced in Oct 2025.
- **Bridgewater AIA Labs:** encodes Dalio's principles with machine learning for investing, not for training staff.
- **Morgan Stanley's AI @ Morgan Stanley Assistant (2023, built with OpenAI):** advisors query the firm's internal research. This is the closest existing product.
- None of these trains a junior's judgment on the firm's past decisions and then measures it.

**Recommended angle: a decision-replay trainer, not a Q&A chatbot.**
1. Show a real past moment (e.g., March 2020, the 2022 rate hikes, the 2023 regional bank failures) using only information available at the time.
2. The new hire writes their call and their reasoning.
3. The AI reveals what the firm actually said and did, cites its sources, and scores how closely the hire's reasoning matched.
4. It tracks each hire's progress over time. This becomes the success metric.

**Data sources**
| Source | Gives | Limitation |
|---|---|---|
| 13F filings (EDGAR) | Actual trades and positions | US long equities only, 45-day lag, no rationale |
| Form ADV Part 2A | Stated investment philosophy | Boilerplate language |
| Letters, memos, market outlooks | The reasoning behind decisions | Polished public versions |
| Books, columns, interviews | The leaders' mental models | Copyright and licensing |

**Firm candidates**
- **Fisher Investments (Plano)** is the lean. It's a wealth manager on the competition's example list, with decades of public Ken Fisher columns and books, public firm commentary and 13F filings. *Not yet checked: how much of the commentary is freely accessible.*
- Oaktree (Howard Marks memos since 1990, plus 13Fs) is an asset manager, so it would fit the research angle instead.
- Berkshire is heavily covered and not a wealth firm. Bridgewater would look unoriginal because of Digital Ray.

**Build approach (about 33 hours available):** a retrieval-based chatbot with citations over a curated set of documents plus 13F data, with 5–10 replay scenarios. **Don't fine-tune a model.**

**Project problems to address in the "limits" section**
1. The real data is private, so the prototype is a demonstration on public proxies. Say so openly.
2. Public writing is the polished version of the reasoning, without the debate, dissent or mistakes.
3. Copyright: keep books and licensed content out of public AI tools. Use freely published material and cite it.
4. Compliance: if a junior passes the bot's view to a client, it becomes a regulated communication (FINRA communication rules, recordkeeping). Keep the tool internal and for training only.
5. Hindsight and survivorship bias: firms showcase their wins. Include the misses.
6. Regime change: past patterns may mislead in new markets.
7. Groupthink: cloning the MD's thinking reduces diversity of views. Possible fix: a "devil's advocate" mode. Expect this in Q&A.
8. Tacit skills (client relationships, business development) transfer only weakly through text. Present it as a judgment accelerator, not a replacement for experience.
9. Hallucinated attribution ("our MD would say X"): every answer needs a source citation, and testing this counts as an AI-log check.
10. Innovation risk if it's presented as a plain chatbot.
11. Business value needs an estimated cost model with labeled assumptions.
12. Time constraints.
13. If comparing stated philosophy against actual 13F trades, call it a neutral "consistency check," never hypocrisy.

---

## 4. Industry problems from public commentary (sourced, for the problem and value sections)

| # | Problem | Key evidence | Source |
|---|---|---|---|
| 1 | **Advisor shortage** | McKinsey: about 100,000-advisor shortfall by 2034. About 110,000 advisors (38%) will retire within a decade, managing 42% of assets. Advisors are about 10 years older than peers in similar professions. McKinsey recommends faster onboarding of new advisors, plus AI and productivity gains. | [Funds Society (Feb 2025)](https://www.fundssociety.com/en/news/asesoramiento/the-u-s-wealth-management-industry-could-face-a-shortage-of-100000-advisors-by-2034/), [InvestmentNews](https://investmentnews.com/practice-management/wealth-management-industry-is-facing-a-looming-retirement-crisis-report-warns/259265) |
| 1a | Counterpoint | "Why the Advisor Shortage Narrative Falls Short"; Cerulli Sep 2026 release titled "Advisor Headcount Set to Grow as AI Expands Capacity" (headline only seen) | [WealthManagement.com](https://www.wealthmanagement.com/professional-development/why-the-advisor-shortage-narrative-falls-short), [Cerulli](https://cerulli.com/press-releases/rookie-advisors-are-in-short-supply) |
| 2 | **Rookie washout and slow training** (strongest fit) | Cerulli: rookie failure rate above 72%. Headcount grew only 2,579 in 2022. Only 15% of rookies say advising was their first career. *2023 data, so cite it as "Cerulli, 2023."* Juniors need 18–24 months to show meaningful results. Osaic: the apprenticeship relationship is the biggest driver of success, and senior advisors lack time to mentor. | [InvestmentNews (Jun 2023)](https://investmentnews.com/industry-news/news/not-enough-rookie-advisors-to-go-around-cerulli-239166), [Nasdaq/FINSUM](https://www.nasdaq.com/articles/72-failure-rate-among-new-advisors), [Wealth Professional (Jul 2023)](https://www.wealthprofessional.ca/news/industry-news/how-to-keep-junior-advisors-from-washing-out-before-they-get-started/377873) |
| 3 | **Heirs leaving after the wealth transfer** | $124T passes through 2048 (Cerulli). Harris Poll: 43% of heirs plan to switch advisors. Cerulli: 52% won't keep the advisor, and only 20% of those who already inherited kept them. Top reason: **different investment philosophy (38%)**. | [WealthManagement.com (Sep 2025)](https://wealthmanagement.com/client-relations/surveying-the-wealth-transfer-may-be-a-wealth-defection-for-many-advisors) |
| 4 | Advisors leaving big firms | The four wirehouses lost a net 517 advisors in H1 2026, more than all of 2025, including 41 teams managing $500M+. Merrill: culture changes and cross-selling pressure. UBS: culture and an outdated platform. About 27,000 advisors move each year (McKinsey). | [WealthManagement.com (Oct 2026)](https://www.wealthmanagement.com/wirehouse-news/wirehouses-lost-517-advisors-in-first-half-of-2026) |
| 5 | Margin compression | Fees are holding, but costs for specialists, technology and custom services squeeze margins. | [WealthManagement.com (Sep 2024)](https://www.wealthmanagement.com/business-planning/fee-compression-hasn-t-played-out-but-margin-compression-is-real), [Cerulli](https://www.cerulli.com/press-releases/fee-compression-and-rising-service-demands-cause-advisors-to-adjust-pricing-structure) |
| 6 | Regulatory scrutiny of AI claims | SEC charged Delphia and Global Predictions over false AI claims ("AI washing"), with $400K in combined penalties (Mar 2024). | [SEC 2024-36](https://www.sec.gov/newsroom/press-releases/2024-36), [Morgan Lewis](https://www.morganlewis.com/pubs/2024/03/sec-charges-investment-advisers-with-making-false-and-misleading-statements-about-their-use-of-ai) |

**Draft pitch:** Senior advisors are retiring (#1), juniors wash out because mentorship doesn't scale (#2), and heirs leave over philosophy (#3). The tool keeps the firm's judgment and teaches it to juniors faster.

**Numbers for the dollar case:** the 72%+ washout rate, the 18–24 months to meaningful results, and the 38% of heirs who leave over philosophy. Before using any figure, confirm it in the original source. This also counts as an AI-log check.

**Existing-product sources:** [Markets Media: Digital Ray](https://www.marketsmedia.com/ray-dalio-launches-digital-ray), [Fortune: Ray Dalio AI clone](https://fortune.com/2025/10/22/ray-dalio-ai-clone-training-advice-investment-mentorship-politics-economy), [HedgeCo: Bridgewater AIA Labs](https://www.hedgeco.net/news/03/2026/bridgewater-dalios-principles-to-algorithmic-intelligence-the-road-to-5billion.html), [OpenAI: Morgan Stanley](https://openai.com/index/morgan-stanley/), [Financial Planning: Morgan Stanley](https://financial-planning.com/news/morgan-stanley-creates-custom-openai-product-for-its-advisors)

---

## 5. Open decisions and next steps

- [ ] **Pick the firm.** Lean: Fisher Investments. First check how much of its public commentary is freely accessible and pull its 13F history from EDGAR.
- [ ] Confirm the decision-replay angle versus a plain chatbot.
- [ ] Choose 5–10 historical replay scenarios and collect the firm's commentary from those dates.
- [ ] Build the business case: a cost model for analyst ramp-up, washout costs, MD mentoring time and assets retained during the wealth transfer. Label all assumptions.
- [ ] Build the prototype: retrieval with citations, a replay flow and a scoring rubric.
- [ ] Run at least two AI checks: citation accuracy (no hallucinated attribution) and verifying statistics in their original sources.
- [ ] Produce the deliverable, the one-page AI log PDF and the 5-minute video in Aditya's own voice.
- [ ] Upload to OneDrive, share with jsomfinlab@utdallas.edu, test the links, and submit the form **by Mon Oct 26, 11:59 PM**.
- [ ] Prepare Q&A answers: groupthink, privacy and compliance, why this isn't just Digital Ray, and how success is measured.
