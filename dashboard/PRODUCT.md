# Product

<!-- impeccable:product-schema 1 -->

All facts below are inferred from the approved design spec
(`docs/superpowers/specs/2026-10-15-salesforce-team-kit-design.md`, sections 1, 2 and 8) and the
Plan 3 constraints. There was no interview round: the owner approved the spec and the plan, and
this file records what they already say. Anything not settled there is listed as open.

## Platform

web

## Users

- **The approver (Jimmy, the owner).** A Salesforce admin/developer who runs a team of Claude Code
  agents in sandboxes and personally deploys to production with change sets. He keeps the office
  open in a browser tab beside his terminal and glances at it while the team works. His job on
  this surface: see who is working, who is stuck, and what waits on him, then act in the terminal.
- **Teammates who install the kit into their own SFDX project.** Same job, their own team. The
  approver's name always comes from `team.json`, never from the code.

## Product Purpose

A local, read-only dashboard (`npm run office`) that shows a six-role Salesforce agent team as an
isometric studio floating on a cloud. It turns the team's event log into a picture that answers,
at a glance: what is each agent doing, what is blocked, what needs the approver, what reached the
sandbox, and what is ready for production. Success: the approver never has to read the log to
know whether he is needed.

## Positioning

The office is driven by the team's own events (status, handoffs, sandbox deploys, change-set
releases, guard blocks) and by the sandbox-only org guard. It shows Salesforce-specific facts a
generic agent dashboard could not: the sandbox cloud with test and coverage results, the change
set parcel on the approver's desk, the production vault that only the approver deploys to, and
guard blocks when an agent aims `sf` at a non-sandbox org.

## Operating Context

- Runs on localhost, polled every 3 seconds; one viewer, usually on a laptop screen beside a
  terminal, sometimes on a phone (below 480px it opens as a plain list).
- Left open for hours: the colours follow the local clock (Night shift, Sunrise, Mint morning,
  Twilight), blending between them, so it must stay readable at every minute of the day.
- Nothing is edited here. Actions (approve a Work Order, deploy a change set) happen in the
  terminal and in Salesforce Setup.

## Capabilities and Constraints

- Desks: one per member, three per row in `team.json` order; the approver in a glass corner
  office. Desks are keyboard buttons that pin the Clipboard.
- Clipboard (details of the pinned agent), Lobby task board (four columns, three tickets each
  until expanded), Tasks cloud card (at most five active tasks), needs-you sign, List view.
- State wording comes only from `STATE_LABELS`; status is never shown by colour alone.
- Motion is for state only and switches off entirely under `prefers-reduced-motion`; no SMIL.
- No new dependencies. The engine (`lib/`) and the layout maths pinned by tests are frozen.
- Open: no decision yet on a dark/light preference beyond the clock-driven moods.

## Brand Commitments

- The approved direction is the mockup: an isometric studio on a cloud, mood follows the clock,
  "fun to watch, with a light Salesforce flavour". Characters, desks and chips stay as drawn.
- The owner rejected emoji and metaphor decoration in earlier rounds. The only glyph kept is the
  spec-mandated "🛡 Guard blocked" bubble text.
- Typeface: Bricolage Grotesque (already loaded), 400/600/800.

## Evidence on Hand

- Fixtures in `test/fixtures/projects` (`busy`, `sf-office`, `empty`, `bad-team`) are made-up
  team states for tests and screenshots. There is no real usage data, no testimonials and no
  metrics; none should be invented.

## Product Principles

1. Glanceable first: whether the approver is needed must be readable in under a second.
2. State, not decoration: every colour and every motion maps to a team state, with text beside it.
3. Readable at every hour: the mood may change the light, never the legibility.
4. Plain words: the same labels in the office, the Clipboard and the List view.

## Accessibility & Inclusion

WCAG 2.1 AA: 4.5:1 for text in every mood and at every blend minute, visible keyboard focus,
desks operable by keyboard, reduced motion honoured, and a List view carrying the same
information as the picture.
