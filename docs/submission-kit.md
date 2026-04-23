# Arc Signal Desk Submission Kit

This document packages copy-ready answers for the hackathon submission form. I kept the answer text in English so it can be pasted directly into the form, and I marked the fields that still require your team to confirm.

## 1. Submission Basics

### Submission Title

`Arc Signal Desk`

### Short Description

`Arc Signal Desk is an agentic intelligence workbench that monetizes every AI analysis step with sub-cent USDC nanopayments on Arc, turning summaries, entity extraction, and graph building into auditable per-action transactions.`

### Long Description

`Arc Signal Desk is a hackathon project built for the Agentic Economy on Arc theme. We wanted to show that agentic applications become much more powerful when every micro-action can be priced, paid for, and audited without gas overhead destroying the margin. Our product turns a research workflow into a sequence of paid actions: a user or upstream agent submits a news article, text input, or preset signal, and the system runs summary, entity extraction, and relation extraction as individually priced steps. Those outputs are then assembled into a live decision desk and a graph view so the user can inspect the result, the evidence behind it, and the payment trail that produced it.

Under the hood, Arc Signal Desk combines Arc settlement, USDC-denominated pricing, and Circle nanopayment-style flows to support economically viable sub-cent transactions. We also built multiple demo paths so the project is not just a concept mockup: local mock mode for reliable demos, a real seller-side payment-gated API flow, a gateway buyer runner for true paid calls, and an Arc UsageReceipt contract that maps successful actions to on-chain evidence. This matters because the core claim of our project is not only that AI tools can be monetized, but that autonomous agents and human users can pay for exactly the next unit of useful work. That creates a more scalable economic model for APIs, machine-to-machine tools, and agentic workflows than subscriptions or gas-heavy per-call settlement.`

## 2. Recommended Form Selections

### Participation Mode

`[Confirm with your team: ONLINE or ONSITE]`

### Categories

Recommended:

- `Finance`
- `Assistant`
- `Developer Tools`
- `Blockchain`
- `API`

### Event Tracks

Recommended primary track:

- `Agent-to-Agent Payments`

Recommended secondary track if multi-select is allowed:

- `On-chain Commerce Primitives`

Reasoning:

- The project already includes an `agent session runner` that performs multiple paid tool calls in sequence.
- The product also acts as a monetized API/workflow primitive, which fits the commerce-infrastructure angle very well.

### Technologies Used

Recommended list:

- `Arc`
- `USDC`
- `Circle Nanopayments`
- `Circle Gateway`
- `x402`
- `Node.js`
- `TypeScript`
- `Express`
- `Viem`
- `Foundry`
- `Vitest`

### Did you use Circle products in your project?

`Yes`

### Circle Developer Console account email

`[Fill in your team’s Circle Developer account email]`

## 3. Circle Product Feedback

You can paste the following directly, then lightly personalize it if you want to optimize for the product feedback incentive:

`Products Used: We used Arc as the settlement environment, USDC as the pricing and payment unit, Circle Nanopayments concepts for sub-cent per-action monetization, and Circle Gateway-style payment-gated flows for the seller and buyer demo path. We also used x402-compatible ideas to frame the pay-per-request API experience, and we added an Arc UsageReceipt contract to create extra on-chain evidence for successful actions.

Use Case: Our project is an agentic intelligence workbench where each AI analysis step can be priced as its own economic action. We chose these products because the whole point of the project was to prove that very small, high-frequency AI actions can still be economically viable when settlement is stablecoin-native and operationally predictable. Arc and Circle were a natural fit because they let us design around per-action pricing instead of subscription bundles.

Successes: What worked well for us was the ability to structure the demo around real paid requests instead of only a mock economic model. The seller-side payment requirement pattern is compelling for API monetization, and the overall Arc + USDC story is easy to explain to judges because it maps directly to usage-based software economics. We also liked that we could keep a local mock mode for development while still designing toward a more realistic payment path. That made it easier to iterate quickly without losing the core architecture.

Challenges: The biggest challenge was stitching together the full mental model across Arc, Circle nanopayment flows, payment-gated APIs, and on-chain proof expectations in a hackathon setting. In particular, there is still a gap between “high-frequency nanopayment economics” and “how teams should best present on-chain transaction evidence” when judging criteria ask for concrete chain-visible activity. We solved this by adding our own receipt layer, but clearer guidance here would reduce confusion. We also think more end-to-end agent-focused examples would help, especially examples where one agent repeatedly pays for machine tools or APIs over many small actions. Better debugging visibility for payment challenge failures and settlement traces would also make the developer experience smoother.

Recommendations: We would love to see a more opinionated reference implementation that combines seller setup, buyer setup, Arc settlement visibility, and agent-to-agent workflow examples in one place. A dedicated guide for “sub-cent API monetization on Arc with Circle” would be especially helpful. It would also be valuable to document recommended patterns for proving usage and settlement during demos, including when to rely on batch settlement semantics versus when to add auxiliary on-chain receipts. Finally, better local sandbox tooling, clearer error messages around payment negotiation, and more examples for multi-step agent workflows would make the stack even easier to adopt and scale.` 

## 4. Optional Supporting Copy

### One-line Pitch

`Arc Signal Desk lets users and agents pay for exactly the next useful AI action, making sub-cent research workflows economically viable on Arc.`

### Problem Statement

`Most AI workflows are still monetized with coarse subscriptions or expensive per-call flows. That model breaks down when agents need to make many tiny, usage-based purchases.`

### Why Now

`Arc and Circle make it practical to build software where value transfer is as granular and programmable as the underlying AI actions.`

## 5. Fields Still Waiting On You

Please confirm these before final submission:

- Participation mode: `ONLINE` or `ONSITE`
- Circle Developer Console account email
- Whether you want to opt in to Circle Developer communications

## 6. Track Reference

The current official event track names visible on the public event page are:

- `Consumer AI`
- `Agent-to-Agent Payments`
- `B2B FinOps & Compliance`
- `On-chain Commerce Primitives`

Source:

- [lablab.ai - Agentic Economy on Arc Hackathon](https://lablab.ai/event/agentic-economy-on-arc-hackathon)
