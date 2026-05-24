# hatch-network-nutrition-webapp

A meal planner that auto-generates a shopping list, tracks nutrition,
and lets users share recipes and week plans with each other. Invite-
only multi-user via Firebase; installable as a PWA.

Live: <https://food.hatchnetwork.ch/>

## Docs

| File | What's in it |
| --- | --- |
| [`spec.md`](./spec.md) | Product spec — goals, data model, views, sync & sharing, acceptance checklist |
| [`CLAUDE.md`](./CLAUDE.md) | Developer / agent handbook — architecture, conventions, Firebase setup, gotchas |
| [`IMPORT.md`](./IMPORT.md) | JSON import schema (ingredients + meals) + the chat-ready prompt |
| [`firestore.rules`](./firestore.rules) | Source of truth for Firestore security rules |

## Quick start

```sh
npm install
cp .env.example .env   # optional — fill in Firebase config to enable sign-in
npm run dev
```

Without `.env`, the app runs in offline-only mode (no sign-in, no Share
tab). To wire it up to your own Firebase project, follow the setup
checklist in [`CLAUDE.md`](./CLAUDE.md#firebase-project-setup).
