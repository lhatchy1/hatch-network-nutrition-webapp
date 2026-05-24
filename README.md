# hatch-network-nutrition-webapp

A lightweight, single-user meal planner: build a library of ingredients and
meals, plan a week (bridge / lunch / dinner per day), see live nutrition
totals against your targets, and auto-generate a shopping list. Fully
client-side, persists to `localStorage`, installable as a PWA.

Live: `https://food.hatchnetwork.ch/`

## Docs

| File | What's in it |
| --- | --- |
| [`spec.md`](./spec.md) | Product spec — goals, data model, views, persistence, PWA, acceptance checklist |
| [`CLAUDE.md`](./CLAUDE.md) | Agent / developer handbook — architecture, conventions, common changes, gotchas |
| [`IMPORT.md`](./IMPORT.md) | JSON import schema + a copy-pasteable prompt for chats |

## Stack

Vite + TypeScript · Alpine.js · Pico.css · service worker · GitHub Pages.

## Local development

```sh
npm install
npm run dev        # http://localhost:5173/
npm run build      # typecheck + production build to dist/
npm run preview    # serve the production build locally (use this to test the PWA)
npm run typecheck  # tsc --noEmit only
npm run icons      # regenerate the placeholder PWA icons
```

## Deployment

`main` is built and deployed to GitHub Pages by
[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml).

**One-time setup in the repo**: Settings → Pages → Source → **GitHub
Actions**, and Settings → Pages → Custom domain → `food.hatchnetwork.ch`
(must match `public/CNAME`). After the first successful run the site
lives at the URL above.

If you fork or move to a different domain: edit `public/CNAME`, the
custom-domain field in Pages settings, and the DNS `CNAME` record at
your registrar (pointing the subdomain at `<username>.github.io`). If
you instead deploy at a subpath, set `base` in `vite.config.ts` to
`/<subpath>/`.

## Importing a plan from a chat

The app's Settings modal includes a **Copy import prompt** button that
copies a self-contained schema brief (the contents of `IMPORT.md`) to
your clipboard. Paste it into any chat, describe the week you want,
save the JSON it produces, and use **Import JSON** in the same modal to
load it. Importing overwrites all current data.

## PWA icons

`public/icons/icon-192.png` and `icon-512.png` are placeholders generated
by `scripts/generate-icons.mjs` (pure Node, no extra deps). Edit the
design inside that script and re-run `npm run icons`, or replace the
PNGs with your own artwork.
