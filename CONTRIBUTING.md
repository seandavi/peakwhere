# Contributing to peakwhere

Thanks for helping. peakwhere is small on purpose: one static page, a few modules, no
server. Contributions that keep it that way are the easiest to accept.

## Before you start

- **Read [`SPEC.md`](SPEC.md) and skim [`adr/`](adr/).** Most "why does it do that?"
  questions are answered there. To change a settled decision, propose a new ADR in your
  PR rather than just changing the behaviour.
- **Open or find an issue first** for anything beyond a small fix, so we can agree on
  the approach before you spend time on it.
- Issues labelled [`good first issue`](../../labels/good%20first%20issue) are scoped for
  newcomers.

## Development

```bash
git clone https://github.com/seandavi/peakwhere.git
cd peakwhere
npm ci           # dev dependencies: test tooling and the libraries we vendor
npm test         # Node's built-in test runner
npm run serve    # http://localhost:8000
```

There is no build step for the app. `vendor/` holds pre-bundled libraries. Never edit it
by hand: change the version in `package.json` and run `npm run vendor`.

## Ground rules

- **Coordinates:** everything inside the app is 0-based half-open. Conversions happen
  only in the parsers.
- **Tests:** every behaviour change comes with a test. The hand-written fixture in
  `test/fixtures/` is ground truth. Don't edit `expected.json` to make a test pass. If
  you believe an expected value is wrong, say so in an issue, with your working.
- **Privacy:** the app must never send user data anywhere. No analytics, no CDNs, no
  remote fonts.
- **Pull requests:** one issue per PR, `Closes #N` in the description, and a line on
  *how you verified* the change. CI must pass.

## Using AI agents

Agent-written contributions are welcome, and this repo was largely built that way. The
same bar applies: a human-readable PR, tests, and an honest *how I verified this*. Agents
should read [`AGENTS.md`](AGENTS.md). Record meaningful work in [`LEDGER.md`](LEDGER.md).

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
