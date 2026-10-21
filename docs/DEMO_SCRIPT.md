# Demo run-of-show (about 12 minutes)

For presenting SovereignFabric to investors or a bank's executive team. Everything runs with fictional people and a fictional bank, "Harbour Bank".

## 15 minutes before

1. `.\reset-demo-data.ps1` (only if you rehearsed: fresh history, original policy), then `.\start-demo.ps1`. If the venue wifi is unreliable, use `.\start-demo.ps1 -Offline`.
2. Open two browser windows side by side:
   - **Left:** http://localhost:3000/advisor (the bank's own app)
   - **Right:** http://localhost:3000, signed in as **Margaret Ellis (Group Chief Executive)**
3. In the right window, open **Presenter → Warm up the stack**. All three checks should be green.
4. In Advisor Assist, make sure **Route through SovereignFabric** is **off**.

## 1. The problem (2 min) · Advisor Assist, switch off

> "This is a typical internal AI tool at a bank: advisors ask it about customers. It's built on the standard OpenAI SDK."

- Click **"Prepare a home loan pre-approval summary…"**.
- Point at **What left the bank**: the TFN and email are highlighted in red, on their way to an external model provider.

> "Every bank has dozens of these. Each one sends customer identifiers straight to a third party, and nobody at board level can see it."

## 2. The one-line fix (2 min) · flip the switch

- Flip **Route through SovereignFabric**. Point at the highlighted `baseURL` line.

> "Integration is one line. The app's code, SDK and prompts don't change."

- Click the same suggestion again.
- **What left the bank** now shows `⟦AU_TFN_1⟧` and `⟦EMAIL_1⟧` in green, yet the advisor's answer still contains the real TFN.

> "The model never sees the customer's identifiers. The gateway puts them back for the advisor on the way in."

- Point at **Gateway decision**: identity verified (the advisor's own name), policy, redaction, routing, audit number.

## 3. Policy in action (1 min)

- Click **"Check Medicare number…"**. It's **blocked**, and *What left the bank* says nothing was sent.

> "Health data is outside Retail Banking's entitlement, so the request is stopped before it leaves. That's per-department policy, not a blanket rule."

## 4. The executive view (3 min) · right window

- **Command Centre:** the requests you just made are already in **Live activity**.
- **Presenter → Live traffic on.** The feed starts moving with simulated staff.
- **Presenter → "Card data sent to a vendor model".** A blocked event appears.

> "This is every AI request across the organisation, as it happens: who, which app, what was protected, what was stopped."

- **People & Apps:** click the top person to show their timeline and the data types they've sent.

> "Staff are told about this in the employee notice. It's transparent governance, not covert surveillance. And the bank can switch executives to pseudonyms."

## 5. Change control (2 min)

- **Switch persona → Daniel Okoye (CISO) → Policies → Propose a change.** Add a restricted term (e.g. a confidential project name), click **Estimate impact**, add a note, and **Submit for approval**.
- **Switch persona → Margaret Ellis → Policies.** Review the change and its impact, then **Approve and activate**.

> "No single person can change what the bank's AI is allowed to do. The CISO proposes, an executive approves, and both are on the record."

## 6. The regulator's view (1 min)

- **Switch persona → Fatima Rahman (Compliance) → Evidence Pack.**

> "This is what goes to APRA reviews: data protection, access, detection, a tamper-evident audit trail re-verified on the spot, change history, and model-provider concentration for CPS 230."

## 7. Close (1 min)

> "It's a container the bank runs inside its own network. Apps change one line. Executives get this view on day one."

## If something goes wrong

| Symptom | Fix |
|---|---|
| A step is slow or times out | The model is busy. The gateway falls back to the next model automatically; ask again. If it keeps happening, restart with `-Offline`. |
| "Signed out" | Sign in again; sessions last 8 hours. |
| Live activity says "connecting…" | Refresh the page. |
| Cached answer repeats from rehearsal | **Presenter → Clear cache**. |
