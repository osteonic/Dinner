# Dinner Plan

A static web app for the week's dinners: tonight's two options (A = quick, B = bigger cook), each recipe with tap-to-check ingredients and numbered steps, the week at a glance, and a grocery checklist. No build step, no backend — it runs on GitHub Pages.

## How it works

| Path | What it holds | Public? |
| --- | --- | --- |
| `index.html`, `app.js`, `app.css` | The app | Yes |
| `data/plans/YYYY-MM-DD.json` | One file per week, named for its Sunday: names, times, prep notes, grocery list | Yes |
| `data/recipes.enc.json` | The 28 recipes (fixes written in), AES-GCM encrypted | Encrypted |
| `sw.js` | Keeps the last good copy of every file so the app opens with no signal | Yes |
| `private/` | Plaintext recipes and passphrase — git-ignored, never committed | No |

GitHub Pages on a free account requires a public repo. The recipe text comes from a published cookbook, so it is encrypted; the app asks for the passphrase once per phone and remembers it.

The app picks the plan file for the current week's Sunday, and shows next week's (Groceries defaults to it) as soon as that file exists.

## One-time setup

1. Create a **public** repo (e.g. `dinner-plan`) and upload everything here except `private/`.
2. Repo **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*, Branch = `main`, folder `/ (root)`. The site appears at `https://<user>.github.io/dinner-plan/` within a minute or two.
3. On each phone, open the unlock link once: `https://<user>.github.io/dinner-plan/#unlock=<passphrase>`. Then Share → **Add to Home Screen**.

## Daily text

The iOS automation only needs one action — **Send Message**:

```
Dinner tonight: https://<user>.github.io/dinner-plan/
```

The page always opens on today's two options.

## Weekly update (Saturday)

The "Saturday dinner plan + grocery list" scheduled task (Saturdays 4:59 am Central) plans the week in the Claude Doc and ends the new tab with an **App data** block: that block is the file below. Check it with `node tools/check-plan.mjs data/plans/<date>.json` before committing if you can. To add a week by hand:

Add `data/plans/<next Sunday>.json` (format below). On GitHub: **Add file → Create new file**, name it `data/plans/2026-11-22.json`, paste, commit. Old weeks can stay.

```json
{
  "week": "2026-11-22",
  "label": "Nov 22–28",
  "summary": "One sentence on whether the weekly rules pass.",
  "days": [
    {
      "day": "Sunday",
      "a": { "id": "gnocchi-with-sausage-and-garlicky-broccoli-rabe", "name": "Gnocchi with Sausage and Garlicky Broccoli Rabe", "time": "25 min" },
      "b": { "id": "creamy-butternut-pasta-with-spicy-sausage-and-spinach", "name": "Creamy Butternut Pasta with Spicy Sausage and Spinach", "time": "45 min" },
      "protein": "Italian chicken sausage, 12 oz",
      "prep": "Prep note for this night."
    }
  ],
  "grocery": [ { "section": "Produce", "items": ["Broccoli rabe — 1 bunch (1 1/4 lb)"] } ],
  "pantry": ["Kosher salt (Diamond Crystal)"],
  "pantryNote": "Not needed this week: …"
}
```

`days` has all seven, Sunday first. A recipe `id` is its library name lowercased with every run of non-letters/digits turned into `-`. Grocery items are `name — quantity`.

## Changing recipes or the passphrase

Edit `private/recipes.json`, then:

```
node tools/encrypt-recipes.mjs "new-or-same passphrase"
```

Commit the new `data/recipes.enc.json`. Phones re-unlock automatically if the passphrase is unchanged; otherwise open the new unlock link.
