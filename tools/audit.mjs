#!/usr/bin/env node
// Runs every page in fixtures/sites.json through Phi's Reader View and prints
// what came back. Use it to check a rule before sending a pull request, and to
// see whether a change to extraction helped or hurt across the corpus.
//
// This drives a real browser rather than a headless DOM on purpose: lazy
// images, client-rendered articles and the readiness wait only behave honestly
// in a browser that actually runs the page.
//
// Requires Phi Browser and the phi-browser skill. Run it through the skill's
// runner, which supplies the browser helpers:
//
//   node ~/.claude/skills/phi-browser/scripts/runner.mjs < tools/audit.mjs
//
//   ONLY=bbc,theverge  node …      only those ids
//   HTML=0             node …      skip the markup (faster, no leak check)
//
// Writes audit-results.json beside the fixtures.

const fs = require('fs')
const path = require('path')

const root = '/Users/jixiang/Phi/phi-reader-rules'
const { sites } = JSON.parse(
  fs.readFileSync(path.join(root, 'fixtures', 'sites.json'), 'utf8'))

const only = process.env.ONLY ? process.env.ONLY.split(',') : null
const wantHTML = process.env.HTML !== '0'

// Names that should never survive into an article body. Checked against the
// class and id attributes of the extracted markup, so a hit means the rung
// captured the furniture rather than just the article.
const LEAK_WORDS = ['comment', 'related', 'newsletter', 'subscribe',
                    'advertisement', 'breadcrumb']

await enterContext({ kind: 'agent', name: 'reader-audit' })

const results = []
for (const site of sites) {
  if (only && !only.includes(site.id)) continue
  const row = { id: site.id, category: site.category, expect: site.expect }
  const started = Date.now()
  try {
    await goto(site.url, { timeout: 40 })
    const article = await readerArticle({ html: wantHTML })
    const html = article.contentHTML || ''
    Object.assign(row, {
      ok: true,
      rung: article.rung,
      coverage: Math.round(article.coverage * 1000) / 1000,
      chars: article.htmlLength,
      rule: article.rule || null,
      title: (article.title || '').slice(0, 48),
    })
    if (wantHTML) {
      row.imgs = (html.match(/<img/g) || []).length
      // An image still pointing at an inline stand-in renders broken.
      row.placeholderImgs = (html.match(/src="data:/g) || []).length
      row.leaks = LEAK_WORDS.filter(
        (word) => new RegExp(`(id|class)="[^"]*${word}`, 'i').test(html))
    }
  } catch (error) {
    const message = String(error.message || error)
    // The user taking control is a hard stop, not a per-site failure: pushing
    // on would burn the rest of the corpus recording an error that says
    // nothing about extraction.
    if (message.includes('user is controlling')) {
      cliLog('ABORTED: the user took control of the Space')
      break
    }
    row.ok = false
    row.error = message.replace(/^agentSpace\.readerArticle: /, '').split(' — ')[0]
  }
  row.ms = Date.now() - started
  results.push(row)
  cliLog(JSON.stringify(row))
}

fs.writeFileSync(path.join(root, 'audit-results.json'),
                 JSON.stringify(results, null, 2))

const extracted = results.filter((r) => r.ok)
// `expect` is what a healthy run looks like, so a mismatch is the thing to
// look at first — not necessarily a bug, but always a judgement call.
const surprises = results.filter(
  (r) => (r.expect === 'article') !== Boolean(r.ok))
cliLog(`\n${extracted.length}/${results.length} extracted` +
       (surprises.length ? `; ${surprises.length} against expectation: ` +
        surprises.map((r) => r.id).join(', ') : '; all as expected'))
