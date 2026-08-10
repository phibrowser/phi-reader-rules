# Contributing a site rule

You do not need to build Phi, and you do not need to know Swift. A rule is a
few CSS selectors in a JSON file.

## Before you write one

Open the page in Phi and press <kbd>⌘</kbd><kbd>⌥</kbd><kbd>R</kbd>. Write down
what is actually wrong, because it decides what the rule needs to do:

| What you see | What the rule needs |
| --- | --- |
| The article stops partway through | More entries in `content` |
| Comments, related posts, or a breadcrumb appear | A tighter `content`, or `strip` |
| "Continue reading" and the rest never loads | `expand` |
| Reader View refuses to open at all | Usually `content`, sometimes nothing we can fix here |

If Reader View already produces a clean article, do not add a rule. A rule that
merely matches what Readability was doing anyway is one more thing to keep
working when the site is redesigned.

## Finding the selectors

In Phi, right-click the first paragraph of the article and choose Inspect. Walk
up the element tree until you find the smallest element that contains the whole
article and nothing else. That is your `content` selector.

Check it in the Console before writing the file:

```js
document.querySelectorAll("article.body").length   // want 1, or the number of
                                                   // article chunks on the page
```

Prefer selectors that will survive a redesign:

- Good: `#main-content`, `article.post-body`, `[itemprop="articleBody"]`
- Risky: `.css-1x9kzp2`, `div > div > div:nth-child(3)`

A hashed class name is a sign the site's build tool generates them, so it will
change without warning. If that is genuinely all there is, use it and say so in
`notes`.

## Writing the file

Create `rules/<registrable-domain>.json`. The filename has to match the `site`
field, and every `host` in the file has to belong to that domain, unless it is
a `*contains*` pattern.

```json
{
  "$schema": "../schema/rule.schema.json",
  "site": "example.com",
  "rules": [
    {
      "host": "*.example.com",
      "pathPrefix": "/articles",
      "content": ["article.body"],
      "title": "h1.headline",
      "notes": "Readability takes the comment thread because the theme puts it in the same column as the article."
    }
  ]
}
```

Notes on the fields, beyond what
[the README table](README.md#rule-shape) says:

- **`host`.** `*.example.com` matches `example.com` and every subdomain, and is
  usually what you want. Reach for `*contains*` only when the hosts genuinely
  do not share a suffix.
- **`pathPrefix`.** Add one if the domain serves more than articles. A rule
  scoped to `/blog` cannot break the shop.
- **`content`.** Order matters. The matches are concatenated in the order the
  selectors are listed, and duplicates are not removed, so do not list a
  parent and its child.
- **`strip`.** Applies to the extracted content only. You cannot strip
  something that `content` never captured.
- **`forceRung`.** Almost always the wrong tool. It turns off the fallbacks,
  so the day the site is redesigned Reader View stops working entirely instead
  of degrading to Readability. Use it only when the other rungs produce
  something worse than nothing.

## Checking it

```sh
node tools/build.mjs --check
```

Node 20 or later. There is nothing to install.

Then confirm the rule against the live page. In Phi's Console:

```js
document.querySelectorAll("article.body").length
```

Run it on two or three articles from the same site, not just the one that
prompted the rule. Sites often use different templates for a photo essay, a
liveblog, or a paywalled piece.

## Sending the pull request

One site per pull request. In the description, include:

- A link to an article the rule fixes.
- What Reader View did before, in a sentence.

A maintainer will check the rule against the live site. Once it is merged, CI
publishes the table and browsers pick it up within a few hours. Nobody has to
update Phi.

## Removing or fixing a rule

Sites get redesigned and rules go stale. A stale rule is worse than no rule,
because the rule rung is tried first. If a rule has stopped matching, deleting
it is a good pull request, and the same checklist applies.

## Licence

Contributions are released under [CC0 1.0](LICENSE). By opening a pull request
you agree to that.
