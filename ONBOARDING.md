# Review-Master — Pilot Onboarding

Welcome to the Review-Master pilot! This guide gets you installed and running in a few minutes.

## 1. What is Review-Master

Review-Master is a cross-browser (Chrome + Firefox) extension that gamifies GitHub code review. PR authors set an **XP pool** on their pull request, then after merge distribute that XP to reviewers and commenters by percentage. Totals roll up into a **per-team leaderboard**. A "team" is your GitHub org (the repo owner), and each company's data is fully isolated.

## 2. Install

Pick your browser. Each release zip contains the same build — they differ only by intended store.

### Chrome

1. Unzip `review-master-0.1.0-chrome.zip`.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the unzipped folder.

> **Dev alternative:** run `npm install` then `npm run build`, and **Load unpacked** the `dist/` folder.
>
> After any rebuild, click the **↻** (reload) icon on the extension card.

### Firefox

1. Unzip `review-master-0.1.0-firefox.zip`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on** and select `manifest.json` inside the unzipped folder.

> **Heads-up:** temporary add-ons are removed when Firefox restarts — that's expected for the pilot. Just load it again.
>
> **Dev alternative:** **Load Temporary Add-on** → `dist/manifest.json`.
>
> After any rebuild, click the **Reload** button for the add-on.

## 3. Sign in

1. Click the Review-Master **toolbar icon** to open the popup.
2. Sign in with **GitHub** (OAuth).

## 4. Team auto-detection

**Nothing to configure.** The extension detects your team automatically from the GitHub URL —
no Personal Access Token required.

- **At sign-in:** if the active browser tab is already a GitHub page, your team is resolved immediately.
- **On any PR page:** the extension derives your org from the URL (e.g. `github.com/acme/…` → org `acme`) and latches your team in the background on every page load.

You will see your team name appear in the popup's Profile and Leaderboard tabs once you open any PR in your org.

> **Note for admins:** the org must be seeded in the `teams` table before anyone can use the extension with it. Contact the pilot admin if you see "Your GitHub org is not part of the pilot."

## 5. Daily use

1. On your PR page, set an **XP pool**.
2. After the PR **merges**, open the distribution form and split the XP among reviewers/commenters by percentage. The percentages **must sum to 100**. Bot reviewers (GitHub Apps, Copilot, etc.) are excluded automatically.
3. Open the popup to view your **team leaderboard** (shown as `<Team> — GLOBAL TOP 100`).

## 6. Troubleshooting

- **"Open any PR in your org to activate your team."** (in the popup) — you haven't visited a PR page in your org yet. Navigate to any PR in the pilot org and the team will resolve automatically.
- **"Your GitHub org is not part of the pilot."** (on a PR widget) — the PR's org hasn't been seeded into the `teams` table. An admin must add it.
- **General** — after rebuilding/reloading the extension, hard-refresh the PR page and confirm you're signed in.
