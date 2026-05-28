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

## 4. Add a GitHub token

The extension needs a Personal Access Token (PAT) to read your GitHub orgs.

1. Go to <https://github.com/settings/tokens>.
2. Create either:
   - a **classic** PAT with `read:user` + **`read:org`**, **or**
   - a **fine-grained** token with equivalent read access.
3. Paste the token into the popup (you only do this once — it's stored locally in the extension).

> **`read:org` is required.** It's what lets the extension auto-detect your team via the GitHub `/user/orgs` API. Without it, you won't be matched to a pilot team.

## 5. Team auto-detection

Your team is derived from your GitHub org — **nothing to configure**.

- **Authors** are auto-assigned to their team the first time they interact with a PR in a seeded org.
- **Reviewers** who never author a PR rely on **`read:org`** to be detected. Make sure your token includes it.

## 6. Daily use

1. On your PR page, set an **XP pool**.
2. After the PR **merges**, open the distribution form and split the XP among reviewers/commenters by percentage. The percentages **must sum to 100**.
3. Open the popup to view your **team leaderboard** (shown as `<Team> — GLOBAL TOP 100`).

## 7. Troubleshooting

- **"Not in a pilot team"** (in the popup) — your PAT is missing **`read:org`**, or your org hasn't been seeded into the `teams` table (an admin must add it).
- **"Your GitHub org is not part of the pilot."** (on a PR widget) — same root cause: the PR's org isn't a seeded pilot team.
- **General** — after rebuilding/reloading the extension, hard-refresh the PR page. Confirm you're signed in and your PAT is set.
