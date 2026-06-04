# Review-Master v0.1.1 — Pilot Patch

This release removes the GitHub Personal Access Token (PAT) requirement that was blocking pilot
users in private organizations where the org's security policy restricts PAT usage. The extension
now works out of the box after a standard GitHub OAuth sign-in — no token setup needed.

## What changed

### No more GitHub PAT

Previously the extension required a fine-grained PAT with `read:org` scope, pasted manually into
the popup. This broke for users in orgs with PAT restrictions. The PAT and its entire setup UI
have been removed.

**Team resolution** now derives your GitHub org from the current browser tab URL. When you open
the popup or visit a PR page in your org, the extension silently resolves your team in the
background. Nothing to configure.

**Reviewer detection** now reads the reviewer list and comment authors directly from the already-
rendered GitHub PR page, instead of making GitHub REST API calls. Bot reviewers (GitHub Apps,
Copilot, SonarCloud, Claude, any account whose login ends in `[bot]`) are filtered out
automatically.

### Upgrade steps

1. Install the new build — no extra setup required.
2. Sign in with GitHub OAuth as before.
3. Open any PR in your org — your team activates automatically.
4. Any PAT you had stored from v0.1.0 is no longer read by the extension (it remains in
   browser local storage but is ignored; you can clear it from DevTools if you prefer).

## Bug fixes / improvements

- Bot reviewers (Copilot, SonarCloud, Claude, `[bot]` accounts) are excluded from the
  distribution form.
- Removed the unreachable "FETCHING REVIEWERS…" spinner from the distribute panel.
- Popup leaderboard hint updated: "Open any PR in your org to activate your team."

## Known limitations (unchanged from v0.1.0)

- OAuth redirect URL uses broad wildcards in Supabase (`*.chromiumapp.org`,
  `*.extensions.allizom.org`) — acceptable for the closed pilot. To be tightened before
  any public release.
- Reviewer detection relies on GitHub's rendered DOM. If GitHub redesigns the PR page,
  selectors may need updating.
- Orgs must still be manually seeded in the `teams` table by an admin before users in
  that org can participate.

## Artifacts

| File | For |
|------|-----|
| `review-master-0.1.1-chrome.zip` | Chrome — Load unpacked from `chrome://extensions` |
| `review-master-0.1.1-firefox.zip` | Firefox — Load Temporary Add-on from `about:debugging` |
