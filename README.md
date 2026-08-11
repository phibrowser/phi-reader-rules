# Phi Reader View site rules

Per-site extraction rules for Reader View in [Phi Browser](https://github.com/phibrowser/phibrowser-mac).

Reader View strips a page down to the article. It works without a rule on most
sites, but generic extraction has a ceiling, and when it misses on a site you
read every day there is normally nothing you can do about it. That is what this
repository is for. Rules here are data, not code. Phi downloads them at
runtime, so a fix reaches readers without a browser build or an app release.

If Reader View is wrong on a site you care about, send a pull request.
[CONTRIBUTING.md](CONTRIBUTING.md) walks through it.

## How Phi extracts an article

Three rungs, tried in order, and the first one that captures enough of the page
wins:

1. **Rule.** The selectors in this repository.
2. **Readability.** Mozilla's algorithm, which scores candidate nodes mostly by
   regular expressions over `class` and `id` names.
3. **Structural.** A crude fallback over the document outline.

The result is measured against the page rather than against a fixed character
count, so an extraction that returns a fraction of a long article is rejected
and the next rung gets a turn.

A rule earns its place when it beats Readability. Two situations account for
most of them:

- **The article is split across sibling containers.** Readability picks one
  root and the rest of the article is lost. A rule lists several roots and they
  are concatenated in document order.
- **Class and id names carry no meaning.** Utility-class CSS, CSS modules, and
  hashed build output leave Readability's heuristics nothing to score, so it
  guesses, and often takes the comment thread or the related-posts rail along
  with the article.

## Rule shape

One file per site, named after the registrable domain, holding one or more
rules.

```json
{
  "$schema": "../schema/rule.schema.json",
  "site": "example.com",
  "rules": [
    {
      "host": "*.example.com",
      "pathPrefix": "/articles",
      "content": ["article.body", "aside.pullquotes"],
      "strip": [".newsletter-signup"],
      "expand": ["button.read-more"],
      "title": "h1.headline",
      "byline": ".author-name",
      "notes": "Why this rule exists."
    }
  ]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `host` | yes | Exact host, `*.suffix` (which also matches the bare host), or `*contains*`. Exact beats suffix beats contains. |
| `pathPrefix` | no | Restricts the rule to a subtree. Matched on a `/` boundary, so `/blog` does not match `/blogroll`. A longer prefix wins over a shorter one. |
| `pathContains` | no | Restricts the rule to paths containing a substring. Use when the identifying segment sits in the middle — `/comments/`, `/status/` — which no prefix can express. A rule with it outranks one without. |
| `content` | yes | Selectors for the article body. Every match of every selector is concatenated in document order. |
| `strip` | no | Selectors removed from the extracted content. |
| `expand` | no | Selectors clicked before extraction, for read-more controls that hide part of the article. |
| `title` | no | Selector for the title. Falls back to `document.title`. |
| `byline` | no | Selector for the author line. |
| `thread` | no | Marks the page as a thread rather than an article; see below. |
| `forceRung` | no | Pins extraction to `rule`, `readability`, or `structural`. Rarely correct. |
| `notes` | no | Free text for reviewers. Not shipped to the browser. |

### Threads

A question-and-answer page or a comment thread is not one article, it is many
short ones by different people. Concatenating them the way `content` normally
does produces a wall of text in which there is no way to tell where one answer
ends or who wrote it — most of what a reader wants from a thread.

Adding `thread` changes that: each node `content` selects becomes its own post
with a byline, and the reader renders them as separated, optionally indented
cards.

```json
{
  "host": "*.reddit.com",
  "pathContains": "/comments/",
  "content": ["shreddit-post", "shreddit-comment"],
  "thread": {
    "body": "[slot=\"text-body\"], [slot=\"comment\"]",
    "author": "@author",
    "meta": "@score",
    "depth": "@depth"
  }
}
```

| Field | Meaning |
| --- | --- |
| `body` | The post's text. Omit only when the container holds nothing else, or the vote widgets come too. |
| `author` | Who wrote it. |
| `meta` | Score, timestamp, whatever belongs beside the author. |
| `depth` | Nesting depth of a comment tree. Indented up to a fixed maximum. |

Each is either a selector run inside the post, or `@name` to read an attribute
off the post element. The attribute form is not a convenience: Reddit hangs a
comment's author, score and depth on the `shreddit-comment` element, with
nothing inside carrying them.

Two things to know when writing one. A `body` selector that matches nothing
drops the post, so a stale selector makes the whole rule decline and the
generic ladder takes over, rather than the reader showing a column of vote
widgets. And scope the rule with `pathContains`: without it a thread rule also
fires on the subreddit listing or the home timeline, which are feeds, and the
reader presents unrelated posts as one conversation.

[`schema/rule.schema.json`](schema/rule.schema.json) is authoritative and is
enforced in CI.

Not yet supported: pagination across a multi-page article, and per-site
date extraction. Both appear in the Reader View design but the browser does
not read them, so the schema rejects them rather than accepting fields that
would silently do nothing.

## What the browser downloads

CI compiles `rules/` into a single table and publishes it to GitHub Pages.

| File | Purpose |
| --- | --- |
| [`v1/manifest.json`](https://phibrowser.github.io/phi-reader-rules/v1/manifest.json) | Digest and size of the table. Polled. |
| [`v1/rules.json`](https://phibrowser.github.io/phi-reader-rules/v1/rules.json) | The table itself. Downloaded only when the digest changes. |

`rules.json` carries no build timestamp, so its SHA-256 changes only when a
rule changes. Phi keeps the last table it verified on disk and falls back to
the copy bundled in the app, which means Reader View keeps working offline, on
a first run, and when this repository is unreachable.

## Working on the rules

Node 20 or later. No dependencies and no install step.

```sh
node tools/build.mjs --check   # validate
node tools/build.mjs           # validate, then write dist/
```

## Licence

[CC0 1.0](LICENSE). These rules are facts about public markup, and nobody
should have to think about attribution before copying one.
