# Contributing

Small, single-purpose changes are easiest to review. Keep the house rules in `README.md`
and `DESIGN.md`: no paid APIs, no npm dependencies in the Node service, no emojis or
marketing copy in the interface, and a test for behaviour that can regress.

## Before you send a change

```sh
node --test bin/unit.mjs
node bin/design-check.mjs
node bin/test.mjs          # needs a running instance
sh bin/smoke.sh            # needs a running instance
```

For anything visual, include the widths you checked (1440, 390 and 360 are the gate) and
a screenshot or a measurement. For a metadata change, say what happens to an original and
a remaster; those are different records and must stay separate.

## Sign-off (DCO)

Every commit must carry a `Signed-off-by` line:

```sh
git commit -s -m "your message"
```

That certifies the Developer Certificate of Origin 1.1:
<https://developercertificate.org/>. You keep your copyright; you grant the project the
right to distribute your contribution under AGPL-3.0-or-later.

We are not asking for copyright assignment and are not currently selling a commercial
license. If that changes, a separate agreement would be needed before contributions made
without one could be dual-licensed; this file will say so before it happens.

## Reporting bugs and security issues

Use GitHub issues for ordinary bugs. For anything that can read files, write files, bypass
the token or reach an internal address, follow `SECURITY.md` instead of opening a public
issue.
