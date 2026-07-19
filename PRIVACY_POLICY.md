# Privacy Policy — Review-Master

_Last updated: 19 July 2026_

Review-Master ("the extension") is a browser extension that gamifies GitHub
code review. Pull request authors set an XP pool on a pull request and, after
the PR is merged, distribute those XP among the reviewers and commenters who
helped. Totals appear on a per-team leaderboard, where a "team" is a GitHub
organization.

This policy explains what data the extension collects, why, how it is used, and
your choices. We collect only what is needed to provide this single purpose.

## Who we are

Review-Master is an independent project developed and maintained by Ali Marzouk
as an individual developer. It is not affiliated with, sponsored by, or endorsed
by any company or employer. For any privacy questions or requests, contact
**ali.marzouk2@gmail.com**.

## What data we collect

We collect the following, only after you sign in with GitHub:

- **GitHub username** — your GitHub login, used to attribute the XP you give
  and receive and to display you on the leaderboard.
- **Email address** — obtained from GitHub (via the `user:email` OAuth scope)
  when you authenticate, used to create and identify your account.
- **Authentication token** — an OAuth session token issued during sign-in,
  stored locally on your device to keep you signed in.
- **Reviewer and commenter usernames** — when you are the author of a pull
  request, the extension reads the GitHub usernames of the people listed as
  reviewers and commenters on that PR page, so you can award XP to them. It does
  **not** read the source code, diffs, or comment text on the page.
- **XP data** — the pull requests, XP pools, and XP grants you create through
  the extension, used to compute and display the leaderboard.

We do **not** collect: your browsing history, health information, financial or
payment information, personal communications, precise location, keystrokes,
mouse movements, or any general web-activity analytics.

## How we use your data

Your data is used solely to provide the extension's features:

- Authenticate you and keep you signed in.
- Attribute XP grants to the correct author and recipients.
- Compute and display your team's leaderboard.

Your data is **not** used for advertising, profiling, credit or lending
decisions, or any purpose unrelated to the extension's single purpose. We do
**not** sell or rent your data, and we do **not** transfer it to third parties
except the service providers described below that are required to operate the
extension.

## Where your data is stored

- **On your device:** your OAuth session token and minor UI state are stored in
  the browser's local extension storage (`storage.local`).
- **On our backend:** your GitHub username, email, and XP data are stored in
  our [Supabase](https://supabase.com) project (Postgres database and
  authentication). Access is isolated per GitHub organization using database
  row-level security, so one team cannot see another team's data. Supabase acts
  as our data processor; see the [Supabase Privacy Policy](https://supabase.com/privacy).

Authentication is performed through GitHub OAuth. Your interaction with GitHub
is governed by [GitHub's Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

## Data sharing

We do not sell, rent, or share your personal data with third parties for their
own purposes. Data is shared only with the infrastructure providers strictly
necessary to run the extension:

- **GitHub** — for authentication.
- **Supabase** — for backend database and authentication hosting.

Within the extension, your GitHub username and earned XP totals are visible to
other members of your own GitHub organization (your team) as part of the
leaderboard. They are not visible to other organizations.

## Data retention and deletion

We retain your account and XP data for as long as the extension is used by your
team. You can sign out at any time, which removes the session token from your
device. To request deletion of your account data from our backend, email
**ali.marzouk2@gmail.com** and we will remove it.

## Security

Data in transit is protected with HTTPS/TLS. Backend access is restricted by
per-organization row-level security. The session token is stored in the
browser's extension storage on your own device.

## Children's privacy

The extension is intended for professional software-development teams and is not
directed to children under 13. We do not knowingly collect data from children.

## Changes to this policy

We may update this policy from time to time. Material changes will be reflected
by updating the "Last updated" date above.

## Contact

Questions or requests: **ali.marzouk2@gmail.com**
