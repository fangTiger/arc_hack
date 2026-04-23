# Hackathon Documentation Refresh Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a hackathon-ready documentation set for Arc Signal Desk, including a bilingual README, an architecture document with diagrams, a product brief, and a submission-answer kit.

**Architecture:** Treat `README.md` as the bilingual entry point and keep detailed material in focused documents under `docs/`. The new docs should unify the public narrative around `Arc Signal Desk` while preserving the existing runbooks for local development and live demo execution.

**Tech Stack:** Markdown, Mermaid, existing OpenSpec/spec docs, current repository runbooks, Arc + Circle hackathon positioning

---

### Task 1: Unify the external narrative

**Files:**
- Modify: `README.md`
- Create: `docs/product-brief.md`
- Create: `docs/submission-kit.md`

**Step 1: Review the current public story**

Run: `sed -n '1,240p' README.md`
Expected: Confirm the repo still presents itself as a lower-level API demo instead of a product-facing hackathon submission.

**Step 2: Define the stable external product name**

Decision: Use `Arc Signal Desk` as the primary public-facing name and describe the paid extraction API as the execution engine underneath it.

**Step 3: Capture the value proposition**

Write copy that explains:
- why sub-cent per-action pricing matters
- why Arc + USDC + Circle Nanopayments make this viable
- why the product is more than a static API demo

### Task 2: Rewrite the README as the bilingual entry point

**Files:**
- Modify: `README.md`

**Step 1: Add bilingual navigation**

Implement anchor links for `中文` and `English` sections near the top of the file.

**Step 2: Add concise hackathon-facing sections**

Include:
- project summary
- why it fits the Agentic Economy on Arc theme
- key capabilities
- quick start
- documentation links

**Step 3: Preserve operational entry points**

Keep the key commands and page routes for:
- local mock demo
- live workbench
- graph page
- gateway buyer
- Arc receipt demo

### Task 3: Add an architecture document with diagrams

**Files:**
- Create: `docs/architecture.md`

**Step 1: Document the system layers**

Cover:
- client and demo entry points
- Express app and routers
- payment, extraction, import, and receipt domains
- local artifact stores
- external settlement and model dependencies

**Step 2: Add Mermaid diagrams**

Include:
- one system architecture diagram
- one live session flow diagram
- one economic loop / evidence diagram

**Step 3: Keep the document judge-friendly**

Explain how the architecture supports predictable pricing, high-frequency usage, and auditable settlement.

### Task 4: Add product and submission docs

**Files:**
- Create: `docs/product-brief.md`
- Create: `docs/submission-kit.md`

**Step 1: Write the product brief**

Explain:
- problem
- target users
- product advantages
- why this is economically viable on Arc
- which hackathon requirements are satisfied

**Step 2: Prepare copy-paste submission answers**

Provide:
- title
- short description
- long description
- recommended categories
- recommended event track selection
- technologies used
- detailed Circle product feedback

**Step 3: Mark fields that require user confirmation**

Leave clear placeholders for:
- participation mode
- Circle developer account email
- opt-in preference

### Task 5: Verify the documentation set

**Files:**
- Verify: `README.md`
- Verify: `docs/architecture.md`
- Verify: `docs/product-brief.md`
- Verify: `docs/submission-kit.md`

**Step 1: Check link integrity**

Run: `rg -n "\]\(" README.md docs/*.md`
Expected: All internal links point to existing docs or known repo paths.

**Step 2: Check for brand consistency**

Run: `rg -n "Arc Signal Desk|Paid Knowledge Extraction API|trusted research workbench|live console" README.md docs/*.md`
Expected: The new docs consistently describe `Arc Signal Desk` as the top-level product while accurately referencing the underlying paid extraction API where needed.
