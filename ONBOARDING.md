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

### Why the extension needs a token

GitHub OAuth (step 3) only proves **who you are**. To read GitHub data on your behalf — the
list of orgs you belong to (`/user/orgs`, used to match you to your pilot team) and the
reviewers/commenters on a PR (used to build the distribution form) — the extension makes
GitHub REST API calls, and those need a **Personal Access Token (PAT)**. The OAuth login and
the PAT are two separate credentials with two separate jobs (identity vs. data access).

### Is it safe to give the token?

Short version: **yes, for the scopes we ask for** — but understand what you're granting.

- The token is stored **only locally** in your browser's extension storage on your own
  machine. It is **never sent to our servers** (there is no custom server — the only backend
  is Supabase, and the token never goes there). The API calls go **directly from your browser
  to `api.github.com`**.
- We ask for **read-only** scopes (`read:user`, `read:org`). The token **cannot push code,
  change settings, or write anything** to your account or repos.
- `read:org` does let the token *read* your org membership (including private membership).
  If that's sensitive in your context, prefer a **fine-grained** token scoped to only the
  org(s) in the pilot (see below).
- You stay in control: you can **revoke** the token at any time from GitHub settings, and
  setting an **expiration** is recommended.

> Caveat to be honest about: any value stored in extension local storage is readable by you
> (and anything running as you on your machine). Treat the token like a password — don't paste
> it on a shared/public computer, and revoke it when the pilot ends.

### How to create the token (classic — simplest)

1. Go to <https://github.com/settings/tokens> → **Generate new token** → **Generate new token (classic)**.
2. **Note:** name it something recognizable, e.g. `review-master-pilot`.
3. **Expiration:** pick a limited window (e.g. 30–90 days) rather than "No expiration".
4. **Select scopes** — check exactly these two, nothing else:
   - ✅ `read:org` (under **admin:org** → it's the read-only child checkbox)
   - ✅ `read:user` (under **user**)
5. Click **Generate token** and **copy it now** — GitHub shows it only once.
6. Paste it into the Review-Master popup. You only do this once; it's stored locally.

### Alternative: fine-grained token (tighter scope)

If you'd rather not grant org-wide classic read access:

1. <https://github.com/settings/tokens> → **Fine-grained tokens** → **Generate new token**.
2. **Resource owner:** select the org that's part of the pilot.
3. **Expiration:** set a limited window.
4. **Organization permissions:** grant **Members → Read-only** (this is the fine-grained
   equivalent of `read:org`). Repository read access is sufficient for the rest.
5. Generate, copy, and paste into the popup.

> **`read:org` (or fine-grained Members: Read) is required.** It's what lets the extension
> auto-detect your team via the GitHub `/user/orgs` API. Without it, you won't be matched to a
> pilot team. Note that fine-grained tokens for an org may need **org owner approval** before
> they work.

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
