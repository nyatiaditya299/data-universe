# Video script: Data Universe (3 minutes)

**File to submit:** `Nyati_Aditya_Fisher_Video` (the competition allows up to 5 minutes; this script is built for about 3:00).
**Rule to remember:** you must appear on camera or narrate in **your own voice**. No AI voice or avatar.
**Pace:** about 145 words a minute. The spoken text is 431 words, which is about 2:57, so read it calmly; the pauses at the section breaks fill the last few seconds.

---

## Timing and screen plan

| Time | On screen | Section |
|---|---|---|
| 0:00 – 0:22 | The logo, then the sidebar | The problem |
| 0:22 – 0:48 | Datasets tab (the list of 14 public datasets) | Why I built it |
| 0:48 – 1:50 | Build & train tab, then Ask tab (a live question, the clarifying card, the conclusion window, the reasoning tree) | The product |
| 1:50 – 2:43 | Back to the Ask tab; hold on the conclusion window | Limitations |
| 2:43 – 2:57 | The logo again | Next step |

---

## Spoken script

**[0:00 – 0:22] The problem** *(screen: logo, sidebar)*

Hi, I'm Aditya Nyati, an MS Finance student at UT Dallas. In a wealth firm, the best judgment lives in senior people's heads. A new analyst has to form a market view quickly, but the evidence is scattered, and the mentors who could explain how the firm thought about past markets don't have time.

**[0:22 – 0:48] Why I built it** *(screen: Datasets tab)*

So I built Data Universe. A junior asks a question and gets the evidence ranked, with sources, plus a conclusion they can check. At a real firm, it would run on the firm's own advice history. I can't access that, so I built it on public data, with Fisher Investments as my target firm, and designed it so internal documents can plug in later.

**[0:48 – 1:50] The product** *(screen: Build & train, then Ask)*

Step one loads fifteen public datasets on my computer: Fed and FRED data, Shiller valuations, FOMC statements, Berkshire letters, SEC 13F filings, and Fisher's own published commentary and filings. Step two builds a searchable universe of about thirty-five hundred documents and trains the ranking. Eighty percent of auto-generated questions tune it; twenty percent are held back to test it. On those unseen questions, the right source in the top three went from eighty-four to ninety-three percent.

Step three: I ask a question. If it's broad, the app asks clarifying questions first, to narrow the scope. Then I get at least three ranked options, and a conclusion written by an open-source model, with numbered citations that open the exact passage. This tree shows how the answer was reached: the scope, the search, the entries the model read, and which ones it actually cited. If it cites nothing, the app marks the answer low confidence.

**[1:50 – 2:43] Limitations** *(screen: conclusion window)*

Now, the limits. First, no internal data. The real value is a firm's own advice history, which is private, so this is a public-data demonstration, and 13F filings are delayed snapshots that give no reasons. Second, my test questions are auto-generated, so the scores show it finds the right source, not that every answer is right.

Third, the model. Today I use a free hosted model. It's slow, one reply every thirty seconds, and it sends text to a third party. That's fine for public data, but not for a firm. In production this has to run on a locally hosted model: faster, with no queue, and client data never leaves the firm. The app already supports a local endpoint. My laptop is simply too small to run one.

**[2:43 – 2:57] Next step** *(screen: logo)*

The next step is a pilot on anonymized advice logs with a locally hosted model, measuring how much faster juniors form a sourced view. It's a training tool, not client advice. Thank you.

---

## Recording notes

- **Rehearse the demo once before recording.** The free model can take up to 30 seconds to answer. Run your question first, then cut the wait or talk through the tree while it fills in.
- **Good demo questions:** "What is Fisher Investments' top-down investment process?" (your focus company; the answer cites Fisher's own page), "What did the FOMC say about inflation in 2023?" (specific, goes straight to the answer) and "What is happening with inflation?" (broad, shows the clarifying card).
- **Be straight about citations.** The free model skips citations in roughly half of my test runs. If a take comes back uncited, show the "low confidence" label on purpose; it supports your point that the checks work. You can also click **Regenerate**.
- **Numbers you can say with confidence:** 15 datasets, about 3,500 documents, 84% to 93% (right source in the top three on held-out questions). These are in the repository and in the AI log.
- **Leave out industry statistics** (advisor shortage, rookie washout, heirs leaving) unless you have checked each one against its original source. The project handover flags them as unverified.
- **Say "public data" early.** It answers the rule about public information only.
- Stay under 5:00 in any case; going over the limit lowers the presentation score.
