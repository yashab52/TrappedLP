#!/usr/bin/env node
// Regression checks for trapped-book.com (search / AI discoverability).
// No dependencies. Run from the repo root:
//   node _checks/check-site.mjs          local files only
//   node _checks/check-site.mjs --live   also check the deployed site and download links
// The _checks folder is excluded from the GitHub Pages (Jekyll) build because it starts with "_".

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
const ORIGIN = 'https://trapped-book.com';
const CANONICAL = ORIGIN + '/';
const EXPECTED_TITLE = 'Скованные — Яков Ласкер | Официальный сайт романа';
const TRAINING_TOKENS = ['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot', 'Applebot-Extended', 'meta-externalagent'];

let failures = 0;
let warnings = 0;
const ok = (msg) => console.log('  ok   ' + msg);
const fail = (msg) => { failures++; console.log('  FAIL ' + msg); };
const warn = (msg) => { warnings++; console.log('  warn ' + msg); };
const check = (cond, msg, detail = '') => (cond ? ok(msg) : fail(msg + (detail ? ' — ' + detail : '')));

const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const decode = (s) => s
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
const norm = (s) => decode(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const html = read('index.html');
const noComments = html.replace(/<!--[\s\S]*?-->/g, '');
const body = noComments.slice(noComments.indexOf('<body'));
const visibleText = norm(body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, ''));
const all = (re, s = noComments) => [...s.matchAll(re)];
const meta = (attr, name) => all(new RegExp(`<meta\\s+${attr}="${name}"\\s+content="([^"]*)"`, 'gi')).map((m) => decode(m[1]));

console.log('\n== index.html: language, title, description, canonical');
check(/<html\s+lang="ru"/.test(html), 'html lang="ru"');
check(/<meta charset="UTF-8">/i.test(html), 'meta charset UTF-8');
const titles = all(/<title>([\s\S]*?)<\/title>/gi).map((m) => norm(m[1]));
check(titles.length === 1 && titles[0] === EXPECTED_TITLE, 'single <title> with expected text', JSON.stringify(titles));
const desc = meta('name', 'description');
check(desc.length === 1, 'exactly one meta description', String(desc.length));
const description = desc[0] || '';
check(/Скованные/.test(description) && /Ласкер/.test(description), 'description names book and author');
check(description.length >= 70 && description.length <= 230, `description length ${description.length} (70–230)`);
const canon = all(/<link\s+rel="canonical"\s+href="([^"]*)"/gi).map((m) => m[1]);
check(canon.length === 1 && canon[0] === CANONICAL, 'single canonical = ' + CANONICAL, JSON.stringify(canon));
check(!/<meta\s+name="(robots|googlebot|bingbot)"/i.test(noComments), 'no meta robots restrictions');
check(!/data-nosnippet/i.test(noComments), 'no data-nosnippet');

console.log('\n== index.html: visible book and author information (no JavaScript needed)');
const h1 = all(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, body).map((m) => norm(m[1]));
const EXPECTED_H1 = 'Скованные — роман Якова Ласкера';
check(h1.length === 1 && h1[0] === EXPECTED_H1, `single <h1> "${EXPECTED_H1}"`, JSON.stringify(h1));
const mainHtml = (body.match(/<main[\s>][\s\S]*?<\/main>/) || [''])[0];
const footerHtml = (body.match(/<footer[\s>][\s\S]*?<\/footer>/) || [''])[0];
check(/<h1[\s>]/.test(mainHtml) && !/<h1[\s>]/.test(footerHtml), '<h1> is inside <main>, not in <footer>');check(visibleText.includes('Яков Ласкер'), 'author name visible');
check(visibleText.includes('Официальный сайт романа'), 'official-site statement visible');
check(/<main[\s>]/.test(body), '<main> landmark present');
const textFile = (f) => readFileSync(join(ROOT, f), 'utf8').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
for (const f of ['upper_text.txt', 'lower_text.txt']) {
    const missing = textFile(f).filter((line) => !visibleText.includes(norm(line)));
    check(missing.length === 0, `all lines of ${f} appear verbatim on the page`, missing.map((l) => l.slice(0, 40) + '…').join(' | '));
}
const imgs = all(/<img\b[^>]*>/gi, body).map((m) => m[0]);
const noAlt = imgs.filter((t) => !/\balt="[^"]+"/.test(t));
check(noAlt.length === 0, `all ${imgs.length} <img> have alt text`, noAlt.join(' '));

console.log('\n== index.html: local links and assets');
const refs = all(/\b(?:href|src)="([^"]+)"/gi).map((m) => decode(m[1]))
    .filter((u) => !/^(https?:|mailto:|data:|#|javascript:)/i.test(u));
const missingRefs = [...new Set(refs)].filter((u) => !existsSync(join(ROOT, u.split(/[?#]/)[0])));
check(missingRefs.length === 0, `${new Set(refs).size} local href/src targets exist`, missingRefs.join(', '));
const downloads = ['https://qrco.de/bh44oQ', 'https://qrco.de/bh44pR'];
for (const u of downloads) check(body.includes(`href="${u}"`), 'download link present: ' + u);

console.log('\n== index.html: Open Graph / Twitter');
check(meta('property', 'og:url')[0] === CANONICAL, 'og:url = canonical');
for (const [attr, name] of [['property', 'og:image'], ['name', 'twitter:image']]) {
    const u = meta(attr, name)[0] || '';
    check(u.startsWith(ORIGIN + '/') && existsSync(join(ROOT, u.slice(ORIGIN.length + 1))), `${name} is absolute and the file exists`, u);
}
for (const n of ['og:title', 'og:description', 'og:image:alt']) check(meta('property', n).length === 1, `${n} present once`);
check(meta('property', 'og:description')[0] === description && meta('name', 'twitter:description')[0] === description, 'og/twitter description = meta description');

console.log('\n== index.html: JSON-LD');
const blocks = all(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi);
check(blocks.length === 1, 'exactly one JSON-LD block', String(blocks.length));
let graph = [];
try {
    const data = JSON.parse(blocks[0][1]);
    graph = data['@graph'] || [];
    ok('JSON-LD parses');
    check(data['@context'] === 'https://schema.org', '@context is https://schema.org');
} catch (e) {
    fail('JSON-LD parses — ' + e.message);
}
const byId = Object.fromEntries(graph.map((n) => [n['@id'], n]));
check(Object.keys(byId).length === graph.length, 'graph @id values are unique');
check(graph.every((n) => String(n['@id']).startsWith(ORIGIN + '/#')), 'graph @id values are absolute');
const danglingRefs = [];
(function walk(v) {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') {
        const keys = Object.keys(v);
        if (keys.length === 1 && keys[0] === '@id' && !byId[v['@id']]) danglingRefs.push(v['@id']);
        keys.forEach((k) => walk(v[k]));
    }
})(graph);
check(danglingRefs.length === 0, 'all @id references resolve', danglingRefs.join(', '));
const book = graph.find((n) => n['@type'] === 'Book') || {};
const person = graph.find((n) => n['@type'] === 'Person') || {};
const page = graph.find((n) => n['@type'] === 'WebPage') || {};
check(Boolean(h1[0]) && h1[0].startsWith(book.name + ' '), 'visible <h1> starts with Book.name');
check(visibleText.includes(person.name || '∅'), 'Person.name is visible on the page');
check(book.author && book.author['@id'] === person['@id'], 'Book.author → Person');
check(visibleText.includes(norm(book.description || '∅')), 'Book.description is visible text');
check(page.name === titles[0] && page.description === description, 'WebPage name/description = <title>/meta description');
check(page.url === CANONICAL && book.url === CANONICAL, 'WebPage.url and Book.url = canonical');
const cover = byId[ORIGIN + '/#cover'] || {};
check(existsSync(join(ROOT, String(cover.contentUrl || '').slice(ORIGIN.length + 1))), 'cover ImageObject points at an existing file');
const ldUrls = [...(book.encoding || []).map((e) => e.contentUrl), ...(book.workExample || []).map((w) => w.url)];
const unlinked = ldUrls.filter((u) => !body.includes(`href="${u}"`));
check(unlinked.length === 0, `all ${ldUrls.length} JSON-LD download/edition URLs are visible links`, unlinked.join(', '));
check(!('sameAs' in book) && !('sameAs' in person), 'no sameAs claims (none verified)');

console.log('\n== robots.txt');
const robots = existsSync(join(ROOT, 'robots.txt')) ? read('robots.txt') : '';
check(robots.length > 0, 'robots.txt exists');
const agents = [...robots.matchAll(/^\s*user-agent:\s*(.+?)\s*$/gim)].map((m) => m[1]);
check(agents.length === 1 && agents[0] === '*', 'only a wildcard group (no bot named individually)', agents.join(', '));
const named = TRAINING_TOKENS.filter((t) => new RegExp(t, 'i').test(robots.replace(/^#.*$/gm, '')));
check(named.length === 0, 'no AI-training token named (training policy unchanged)', named.join(', '));
check(!/^\s*disallow:\s*\/\s*$/im.test(robots), 'no site-wide Disallow');
check(/^Sitemap: https:\/\/trapped-book\.com\/sitemap\.xml\s*$/m.test(robots), 'Sitemap line points at the canonical sitemap');

console.log('\n== sitemap.xml');
const sitemap = existsSync(join(ROOT, 'sitemap.xml')) ? read('sitemap.xml') : '';
check(/^<\?xml version="1\.0" encoding="UTF-8"\?>\s*<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">[\s\S]*<\/urlset>\s*$/.test(sitemap), 'sitemap.xml well-formed urlset');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
check(locs.length === 1 && locs[0] === CANONICAL, 'sitemap lists exactly the canonical homepage', locs.join(', '));
check((sitemap.match(/<url>/g) || []).length === (sitemap.match(/<\/url>/g) || []).length, 'balanced <url> elements');

console.log('\n== publish hygiene');
try {
    const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    const docs = tracked.filter((f) => /\.md$/i.test(f) && !f.startsWith('_'));
    check(docs.length === 0, 'no Markdown documents tracked for publishing', docs.join(', '));
    const untracked = execSync('git ls-files --others --exclude-standard', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
        .filter((f) => !f.startsWith('_'));
    if (untracked.length) warn('untracked files that would be published if added: ' + untracked.join(', '));
    else ok('no stray untracked files');
} catch (e) {
    warn('git not available: ' + e.message);
}

if (process.argv.includes('--live')) {
    console.log('\n== LIVE ' + ORIGIN + ' (reflects what is deployed, not local edits)');
    const get = async (url, opts = {}) => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 30000);
        try {
            const r = await fetch(url, { redirect: opts.redirect || 'follow', signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (site-check)' } });
            const text = opts.body ? await r.text() : (ctrl.abort(), '');
            return { status: r.status, url: r.url, headers: r.headers, text };
        } catch (e) {
            if (e.name === 'AbortError' && !opts.body) return null;
            return { status: 0, error: e.message };
        } finally {
            clearTimeout(t);
        }
    };
    const live = async (url, opts) => {
        const r = await get(url, opts);
        if (r && r.status === 0) fail(`${url} — network error: ${r.error}`);
        return r;
    };
    const home = await live(CANONICAL, { body: true });
    if (home && home.status) {
        check(home.status === 200 && /text\/html/.test(home.headers.get('content-type')), 'homepage 200 text/html');
        check(!home.headers.get('x-robots-tag'), 'no X-Robots-Tag header');
        const liveMain = (home.text.match(/<main[\s>][\s\S]*?<\/main>/) || [''])[0];
        check(/<h1[\s>]/.test(liveMain), 'live page has an <h1> inside <main>');
        if (home.text.replace(/\r/g, '') === html.replace(/\r/g, '')) ok('live index.html matches local');
        else warn('live index.html differs from local (expected until the change is deployed)');
    }
    for (const u of ['http://trapped-book.com/', 'https://www.trapped-book.com/', 'http://www.trapped-book.com/']) {
        const r = await live(u, { redirect: 'manual', body: true });
        if (r && r.status) {
            const loc = r.headers.get('location') || '';
            check([301, 308].includes(r.status) && /^https:\/\/trapped-book\.com\/?$/.test(loc) || (r.status === 301 && loc.startsWith('http://trapped-book.com')),
                `${u} → permanent redirect toward canonical`, `${r.status} ${loc}`);
        }
    }
    for (const [path, type, local] of [['robots.txt', 'text/plain', robots], ['sitemap.xml', 'xml', sitemap]]) {
        const r = await live(ORIGIN + '/' + path, { body: true });
        if (r && r.status) {
            if (r.status === 200) {
                check((r.headers.get('content-type') || '').includes(type), `/${path} served as ${type}`);
                if (r.text.replace(/\r/g, '') === local.replace(/\r/g, '')) ok(`live /${path} matches local`);
                else warn(`live /${path} differs from local (expected until deployed)`);
            } else warn(`/${path} returns ${r.status} (expected until deployed)`);
        }
    }
    const nf = await live(ORIGIN + '/this-page-does-not-exist-' + Date.now(), { body: true });
    if (nf && nf.status) check(nf.status === 404, 'nonexistent URL returns 404', String(nf.status));
    for (const p of ['SEO_AI_DISCOVERABILITY_TASK.md', 'CLAUDE_CODE_BRIEF.md', '_checks/check-site.mjs']) {
        const r = await live(ORIGIN + '/' + p, { body: true });
        if (r && r.status) check(r.status === 404, `/${p} is not published`, String(r.status));
    }
    const cov = await live(ORIGIN + '/Trapped_Book_RU.jpg', { body: true });
    if (cov && cov.status) check(cov.status === 200 && /image\/jpeg/.test(cov.headers.get('content-type')), 'cover image 200 image/jpeg');
    const external = [
        ...downloads,
        'https://www.dropbox.com/scl/fi/asm5oevgbaik54soub07l/.pdf?rlkey=1zl7efb15bsji0t8idxym5vuh&st=6mozcxql&dl=1',
        'https://www.litres.ru/book/yakov-lasker/skovannye-74687337/',
        'https://trappedru.podbean.com/',
    ];
    for (const u of external) {
        const r = await get(u);
        if (r === null) ok(`${u} → responded (body not downloaded)`);
        else if (r.status >= 200 && r.status < 400) ok(`${u} → ${r.status}`);
        else if (r.status === 403) warn(`${u} → 403 to this script (sites often block scripted requests; check in a browser)`);
        else fail(`${u} → ${r.status || r.error}`);
    }
}

console.log(`\n${failures ? 'FAILED' : 'PASSED'}: ${failures} failure(s), ${warnings} warning(s)\n`);
process.exit(failures ? 1 : 0);
