# Soulprint — offer & launch notes

**One line:** A private, local-first home for your AI companion's identity. Distill them from a chat history, then export them to any platform when one breaks, changes, or shuts down.

## The buyer and the pain (validated)

People who maintain AI companions on Character.AI, Janitor AI, SpicyChat, Talkie, Replika, Candy AI, Nomi and SillyTavern invest months building a personality, a backstory, a relationship, the names the bot calls them. Then:

- Janitor's persona editor dropped auto-save; people lose work on every reload. The official community advice is literally *"keep the master text in a notes app or doc outside the platform."*
- Character.AI changed models and broke long-running personas; whole subreddits grieve the old version.
- Platforms shut down, paywall, or wipe data with no export.

So users hand-maintain a Notion doc, screenshot conversations, and re-paste personality descriptions into every new platform. **Soulprint is that notes file, done right, plus the migration tool.**

This is the audience RoboRhythms already reaches (r/AIChatCompanions, the ranking companion pages, the roleplay generator). Distribution cost is near zero, which is the whole point of building here instead of a cold vertical.

## What it does

- **Build a companion bible**: identity, personality, voice, backstory, the bond, pet names, greeting, example lines, memory timeline.
- **Distill from chat history** (the magic moment, free): paste real messages and it reads, 100% locally, the names they call you, the words they lean on, their tone, their speech style, and the lines that sound most like them, then pre-fills the bible.
- **Export anywhere**: real **Character Card V2** JSON, the **PNG card** with data embedded in the image (drag straight into SillyTavern/Janitor), Character.AI fields, Janitor fields, a generic system prompt for Candy/Nomi/ChatGPT/Claude, and a complete master document.
- **Import** an existing .json or .png card to start from it.

**Privacy is the product.** Companion data is intensely personal and often hidden from partners. Soulprint never uploads anything: no account, no server, works offline. That is both the ethic and the strongest sales line for this exact audience.

## Business model

- **Free:** one companion, full editing, full chat distillation, Character Card V2 JSON export, and a generic system prompt. Forever.
- **Pro, $19 one-time** (offline key, no account): unlimited companions, the portable PNG card, Character.AI + Janitor exports, the master document, the memory timeline, full-vault .soulprint backups, and card import beyond one.

$19 is an impulse price for someone who has spent months on a companion they are about to lose. The free tier gives the wow (distillation) so the upgrade sells itself when they want their second companion or the portable card.

## Pre-minted Pro keys (offline, self-validating)

Key #1 was burned during build verification. Five fresh keys:

```
SOULPRINT-P3X8-R6T1-X0N8
SOULPRINT-W5N2-B8H7-FXKB
SOULPRINT-K4D9-Z2V6-G7N0
SOULPRINT-T8M3-Y5C1-F3NP
SOULPRINT-Q9R4-N712-0DP0
```

Mint more: `node -e "import('./src/license.js').then(m=>console.log(m.mintKey('AB12','CD34')))"` (any two 4-char Crockford blocks).

## Morning to-do (handoff)

1. Create the **$19 listing** (Payhip or Gumroad). Cover = `docs/img/cover.jpeg` (the distill report). Gallery = `docs/img/screenshot-export.jpeg`, `docs/img/sample-card.png`.
2. Set `BUY_URL` in `src/app.js` to the listing, then `node build.mjs` + commit + push so the in-app "Get Pro" links resolve.
3. Record a 25-sec demo: paste a chat, hit **Distill their essence**, watch the pet names / tone / voice appear, then **Export → PNG card**.
4. Seed value-first (lead by solving *their* problem, never a drive-by link): r/JanitorAI_Official (the persona-not-saving pain), r/CharacterAI (model-change grief), r/SillyTavernAI (the card export angle), r/AIChatCompanions (ours). The honest hook: "I got tired of losing my characters when platforms change, so I built a local thing that rebuilds them anywhere."

## Honest scope

Distillation is heuristic, not a model: it reads patterns (pet names, vocabulary, tone, speech style, best lines) and drafts fields the user edits. It never claims to be perfect and says so in-app. The Character Card V2 export is spec-accurate and verified to round-trip through a real PNG. No upcoming-feature promises baked into copy.
