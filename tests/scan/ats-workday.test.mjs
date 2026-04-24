import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'node:test';
import { installMockFetch } from '../helpers.mjs';
import { parseWorkdayUrl, fetchWorkday, verifySlug } from '../../src/scan/ats/workday.mjs';

test('parseWorkdayUrl — extracts tenant, pod, site from valid URL', () => {
  const { tenant, pod, site } = parseWorkdayUrl(
    'https://totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers'
  );
  assert.equal(tenant, 'totalenergies');
  assert.equal(pod, 'wd3');
  assert.equal(site, 'TotalEnergies_careers');
});

test('parseWorkdayUrl — handles trailing slash', () => {
  const { tenant, pod, site } = parseWorkdayUrl(
    'https://sanofi.wd3.myworkdayjobs.com/SanofiCareers/'
  );
  assert.equal(tenant, 'sanofi');
  assert.equal(pod, 'wd3');
  assert.equal(site, 'SanofiCareers');
});

test('parseWorkdayUrl — handles pod wd5', () => {
  const { pod } = parseWorkdayUrl('https://capgemini.wd5.myworkdayjobs.com/CapgeminiCareers');
  assert.equal(pod, 'wd5');
});

test('parseWorkdayUrl — ignores query string and fragment', () => {
  const { tenant, pod, site } = parseWorkdayUrl(
    'https://schneider.wd3.myworkdayjobs.com/Global?foo=bar#section'
  );
  assert.equal(tenant, 'schneider');
  assert.equal(pod, 'wd3');
  assert.equal(site, 'Global');
});

test('parseWorkdayUrl — throws on non-Workday URL', () => {
  assert.throws(() => parseWorkdayUrl('https://jobs.lever.co/stripe'), /not a Workday URL/);
});

test('parseWorkdayUrl — throws on Workday URL missing site', () => {
  assert.throws(
    () => parseWorkdayUrl('https://totalenergies.wd3.myworkdayjobs.com/'),
    /not a Workday URL/
  );
});

test('parseWorkdayUrl — strips en-US locale prefix from URL', () => {
  const { tenant, pod, site } = parseWorkdayUrl(
    'https://totalenergies.wd3.myworkdayjobs.com/en-US/TotalEnergies_careers'
  );
  assert.equal(tenant, 'totalenergies');
  assert.equal(pod, 'wd3');
  assert.equal(site, 'TotalEnergies_careers');
});

test('parseWorkdayUrl — strips fr-FR locale prefix', () => {
  const { site } = parseWorkdayUrl('https://sanofi.wd3.myworkdayjobs.com/fr-FR/SanofiCareers');
  assert.equal(site, 'SanofiCareers');
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fx1Path = path.join(__dirname, '..', 'fixtures', 'workday-totalenergies-page1.json');
const fx2Path = path.join(__dirname, '..', 'fixtures', 'workday-totalenergies-page2.json');

let restore;
afterEach(() => {
  if (restore) restore();
});

test('fetchWorkday — single page, maps postings to Offer contract', async () => {
  const fixture = JSON.parse(fs.readFileSync(fx1Path, 'utf8'));
  restore = installMockFetch({
    'https://totalenergies.wd3.myworkdayjobs.com/wday/cxs/totalenergies/TotalEnergies_careers/jobs':
      fixture,
  });

  const { offers } = await fetchWorkday(
    'https://totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers',
    'TotalEnergies',
    { pageSize: 50 } // > total, so only one call
  );

  assert.equal(offers.length, 3);
  const o = offers[0];
  assert.equal(o.title, 'Data Engineer - Paris');
  assert.equal(
    o.url,
    'https://totalenergies.wd3.myworkdayjobs.com/en-US/TotalEnergies_careers/job/Paris/Data-Engineer---Paris_R12345'
  );
  assert.equal(o.company, 'TotalEnergies');
  assert.equal(o.location, 'Paris, France');
  assert.equal(o.platform, 'workday');
  assert.equal(typeof o.body, 'string');
});

function installSequentialMockFetch(url, responses) {
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = async (reqUrl) => {
    const key = typeof reqUrl === 'string' ? reqUrl : reqUrl.toString();
    if (key !== url) throw new Error(`sequentialMock: unexpected URL ${key}`);
    if (i >= responses.length) throw new Error(`sequentialMock: exhausted (called ${i + 1} times)`);
    const body = responses[i++];
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  return () => {
    globalThis.fetch = original;
  };
}

test('fetchWorkday — paginates until a partial page is returned', async () => {
  const page1 = JSON.parse(fs.readFileSync(fx1Path, 'utf8'));
  const page2 = JSON.parse(fs.readFileSync(fx2Path, 'utf8'));
  restore = installSequentialMockFetch(
    'https://totalenergies.wd3.myworkdayjobs.com/wday/cxs/totalenergies/TotalEnergies_careers/jobs',
    [page1, page2]
  );

  const { offers } = await fetchWorkday(
    'https://totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers',
    'TotalEnergies',
    { pageSize: 3, searchTerms: [''] } // page1 has 3 (full), page2 has 1 (partial → stop)
  );

  assert.equal(offers.length, 4);
  assert.equal(offers[0].title, 'Data Engineer - Paris');
  assert.equal(offers[3].title, 'Cloud Infrastructure Engineer');
});

test('fetchWorkday — stops on first empty page', async () => {
  restore = installSequentialMockFetch(
    'https://sanofi.wd3.myworkdayjobs.com/wday/cxs/sanofi/SanofiCareers/jobs',
    [{ total: 0, jobPostings: [] }]
  );

  const { offers } = await fetchWorkday(
    'https://sanofi.wd3.myworkdayjobs.com/SanofiCareers',
    'Sanofi',
    { pageSize: 20, searchTerms: [''] }
  );

  assert.equal(offers.length, 0);
});

test('fetchWorkday — throws on HTTP error', async () => {
  restore = installMockFetch({
    'https://broken.wd3.myworkdayjobs.com/wday/cxs/broken/BrokenSite/jobs': {
      status: 500,
      body: { error: 'nope' },
    },
  });

  await assert.rejects(
    () =>
      fetchWorkday('https://broken.wd3.myworkdayjobs.com/BrokenSite', 'Broken', { pageSize: 20 }),
    /HTTP 500/
  );
});

test('verifySlug — returns ok with count on valid response', async () => {
  const page1 = JSON.parse(fs.readFileSync(fx1Path, 'utf8'));
  restore = installMockFetch({
    'https://totalenergies.wd3.myworkdayjobs.com/wday/cxs/totalenergies/TotalEnergies_careers/jobs':
      page1,
  });

  const r = await verifySlug('https://totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers');
  assert.equal(r.ok, true);
  assert.equal(r.count, 23); // fixture has total:23
});

test('verifySlug — returns ok with count 0 on empty response', async () => {
  restore = installMockFetch({
    'https://sanofi.wd3.myworkdayjobs.com/wday/cxs/sanofi/SanofiCareers/jobs': {
      total: 0,
      jobPostings: [],
    },
  });

  const r = await verifySlug('https://sanofi.wd3.myworkdayjobs.com/SanofiCareers');
  assert.equal(r.ok, true);
  assert.equal(r.count, 0);
});

test('verifySlug — returns ko on HTTP 404', async () => {
  restore = installMockFetch({
    'https://missing.wd3.myworkdayjobs.com/wday/cxs/missing/Nope/jobs': {
      status: 404,
      body: {},
    },
  });

  const r = await verifySlug('https://missing.wd3.myworkdayjobs.com/Nope');
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.match(r.reason, /HTTP 404/);
});

test('verifySlug — returns ko on non-Workday URL', async () => {
  const r = await verifySlug('https://jobs.lever.co/stripe');
  assert.equal(r.ok, false);
  assert.match(r.reason, /not a Workday URL/);
});

test('verifySlug — reads data.total when present', async () => {
  restore = installMockFetch({
    'https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/Careers/jobs': {
      total: 247,
      jobPostings: [{ title: 'one' }],
    },
  });
  const r = await verifySlug('https://acme.wd3.myworkdayjobs.com/Careers');
  assert.equal(r.ok, true);
  assert.equal(r.count, 247);
});

test('verifySlug — falls back to jobPostings.length when total absent', async () => {
  restore = installMockFetch({
    'https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/Careers/jobs': {
      jobPostings: [{ title: 'one' }],
    },
  });
  const r = await verifySlug('https://acme.wd3.myworkdayjobs.com/Careers');
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
});

test('fetchWorkday — issues one POST per searchTerm and dedupes by url', async () => {
  const original = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    bodies.push(body);
    const unique = body.searchText === 'Intern' ? 'U1' : 'U2';
    return {
      ok: true,
      status: 200,
      json: async () => ({
        total: 2,
        jobPostings: [
          { title: 'Shared', externalPath: '/job/shared', locationsText: 'Paris' },
          {
            title: `${body.searchText} only`,
            externalPath: `/job/${unique}`,
            locationsText: 'Paris',
          },
        ],
      }),
      text: async () => '',
    };
  };
  restore = () => {
    globalThis.fetch = original;
  };

  const { offers } = await fetchWorkday(
    'https://sanofi.wd3.myworkdayjobs.com/SanofiCareers',
    'Sanofi',
    { searchTerms: ['Intern', 'Stage'], pageSize: 20 }
  );

  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies.map((b) => b.searchText).sort(), ['Intern', 'Stage']);
  assert.equal(offers.length, 3);
  const urls = offers.map((o) => o.url).sort();
  assert.deepEqual(urls, [
    'https://sanofi.wd3.myworkdayjobs.com/en-US/SanofiCareers/job/U1',
    'https://sanofi.wd3.myworkdayjobs.com/en-US/SanofiCareers/job/U2',
    'https://sanofi.wd3.myworkdayjobs.com/en-US/SanofiCareers/job/shared',
  ]);
});

test('fetchWorkday — absent searchTerms falls back to WORKDAY_SEARCH_TERMS', async () => {
  const original = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, opts) => {
    bodies.push(JSON.parse(opts.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({ total: 0, jobPostings: [] }),
      text: async () => '',
    };
  };
  restore = () => {
    globalThis.fetch = original;
  };

  await fetchWorkday('https://acme.wd3.myworkdayjobs.com/AcmeCareers', 'Acme', {
    pageSize: 20,
  });

  const terms = bodies.map((b) => b.searchText).sort();
  assert.deepEqual(terms, ['Apprenti', 'Intern', 'Internship', 'Stage', 'Stagiaire']);
});

test('fetchWorkday — empty searchTerms array also falls back to WORKDAY_SEARCH_TERMS', async () => {
  const original = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, opts) => {
    bodies.push(JSON.parse(opts.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({ total: 0, jobPostings: [] }),
      text: async () => '',
    };
  };
  restore = () => {
    globalThis.fetch = original;
  };

  await fetchWorkday('https://acme.wd3.myworkdayjobs.com/AcmeCareers', 'Acme', {
    searchTerms: [],
    pageSize: 20,
  });

  assert.equal(bodies.length, 5);
});

test('fetchWorkday — stops pagination when MAX_OFFERS reached', async () => {
  // Mock: return full pages indefinitely (simulate a huge board),
  // with unique externalPaths per call so dedup-by-url doesn't interfere.
  const original = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    const base = (callCount - 1) * 5;
    const page = {
      total: 999,
      jobPostings: Array.from({ length: 5 }, (_, i) => ({
        title: `Job ${base + i}`,
        externalPath: `/job/Job-${base + i}_R${1000 + base + i}`,
        locationsText: 'Paris',
      })),
    };
    return { ok: true, status: 200, json: async () => page, text: async () => '' };
  };
  restore = () => {
    globalThis.fetch = original;
  };

  const { offers } = await fetchWorkday('https://big.wd3.myworkdayjobs.com/BigCorp', 'BigCorp', {
    pageSize: 5,
    maxOffers: 12,
    searchTerms: [''],
  });

  // Should stop at 12 (or after the page that crosses 12), not loop forever
  assert.ok(offers.length <= 15, `Expected <= 15 offers, got ${offers.length}`);
  assert.ok(offers.length >= 12, `Expected >= 12 offers, got ${offers.length}`);
  assert.ok(callCount <= 3, `Expected <= 3 fetch calls, got ${callCount}`);
});

test('fetchWorkday — returns warnings array when maxOffers cap is hit', async () => {
  const original = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    const base = (callCount - 1) * 3;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        total: 999,
        jobPostings: Array.from({ length: 3 }, (_, i) => ({
          title: `Job ${base + i}`,
          externalPath: `/job/J${base + i}`,
          locationsText: 'Paris',
        })),
      }),
      text: async () => '',
    };
  };
  restore = () => {
    globalThis.fetch = original;
  };

  const res = await fetchWorkday('https://acme.wd3.myworkdayjobs.com/AcmeCareers', 'Acme', {
    pageSize: 3,
    maxOffers: 2,
    searchTerms: [''],
  });

  assert.equal(typeof res, 'object');
  assert.ok(Array.isArray(res.warnings), 'expected warnings array');
  assert.equal(res.warnings.length, 1);
  assert.ok(res.warnings[0].includes('stopped at'), `unexpected warning: ${res.warnings[0]}`);
});

test('fetchWorkday — warnings empty when cap not reached', async () => {
  restore = installMockFetch({
    'https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/AcmeCareers/jobs': {
      total: 1,
      jobPostings: [{ title: 'Solo', externalPath: '/job/solo', locationsText: 'Paris' }],
    },
  });

  const res = await fetchWorkday('https://acme.wd3.myworkdayjobs.com/AcmeCareers', 'Acme', {
    pageSize: 20,
  });

  assert.ok(Array.isArray(res.warnings), 'expected warnings array');
  assert.equal(res.warnings.length, 0);
});

test('fetchWorkday — runs the 5 default terms in parallel, not sequentially', async () => {
  const original = globalThis.fetch;
  const startTimes = [];
  globalThis.fetch = async () => {
    startTimes.push(Date.now());
    await new Promise((r) => setTimeout(r, 50));
    return {
      ok: true,
      status: 200,
      json: async () => ({ total: 0, jobPostings: [] }),
      text: async () => '',
    };
  };
  restore = () => {
    globalThis.fetch = original;
  };

  await fetchWorkday('https://acme.wd3.myworkdayjobs.com/AcmeCareers', 'Acme', {
    pageSize: 20,
  });

  assert.equal(startTimes.length, 5, 'expected one fetch per default term');
  const span = startTimes[4] - startTimes[0];
  assert.ok(
    span < 30,
    `expected concurrent start (span < 30ms), got span=${span}ms — suggests sequential execution`
  );
});

test('fetchWorkday — emits term_start and term_done progress events', async () => {
  const original = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = async (url, opts) => {
    callCount++;
    const body = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        total: 1,
        jobPostings: [
          {
            title: `${body.searchText} role`,
            externalPath: `/job/${body.searchText}-${callCount}`,
            locationsText: 'Paris',
          },
        ],
      }),
      text: async () => '',
    };
  };
  restore = () => {
    globalThis.fetch = original;
  };

  const events = [];
  await fetchWorkday('https://acme.wd3.myworkdayjobs.com/AcmeCareers', 'Acme', {
    pageSize: 20,
    onProgress: (e) => events.push(e),
  });

  const starts = events.filter((e) => e.type === 'term_start');
  const dones = events.filter((e) => e.type === 'term_done');
  assert.equal(starts.length, 5);
  assert.equal(dones.length, 5);

  for (const e of starts) {
    assert.equal(e.tenant, 'acme');
    assert.ok(typeof e.term === 'string' && e.term.length > 0);
  }
  for (const e of dones) {
    assert.equal(e.tenant, 'acme');
    assert.ok(typeof e.term === 'string' && e.term.length > 0);
    assert.ok(typeof e.pages === 'number' && e.pages >= 1, `expected pages >= 1, got ${e.pages}`);
    assert.ok(typeof e.total === 'number' && e.total >= 1);
  }
});

test('fetchWorkday — respects `total` and stops before overflow offset', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ offset: body.offset, searchText: body.searchText });
    if (calls.length > 500) throw new Error('runaway — guard 1 not implemented yet');
    const postings = Array.from({ length: 20 }, (_, i) => ({
      externalPath: `/job/p${body.offset + i}`,
      title: `Title ${body.offset + i}`,
      locationsText: 'Paris',
    }));
    return {
      ok: true,
      status: 200,
      json: async () => ({ total: 20, jobPostings: postings }),
      text: async () => '',
    };
  };
  restore = () => {
    globalThis.fetch = original;
  };

  const res = await fetchWorkday(
    'https://ten.wd3.myworkdayjobs.com/Site',
    'Tenant',
    { searchTerms: ['x'], pageSize: 20, maxOffers: 1000 }
  );
  assert.equal(calls.length, 1, 'should POST exactly once');
  assert.equal(res.offers.length, 20);
});

test('fetchWorkday — breaks on wrap-around when a page contributes no new paths', async () => {
  const original = globalThis.fetch;
  const calls = [];
  const samePage = Array.from({ length: 20 }, (_, i) => ({
    externalPath: `/job/wrap${i}`,
    title: `Title ${i}`,
    locationsText: 'Paris',
  }));
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ offset: body.offset });
    if (calls.length > 500) throw new Error('runaway — guard 2 not implemented yet');
    return {
      ok: true,
      status: 200,
      json: async () => ({ jobPostings: samePage }),
      text: async () => '',
    };
  };
  restore = () => {
    globalThis.fetch = original;
  };

  const res = await fetchWorkday(
    'https://ten.wd3.myworkdayjobs.com/Site',
    'Tenant',
    { searchTerms: ['x'], pageSize: 20, maxOffers: 1000 }
  );
  assert.equal(calls.length, 2, 'should POST twice — first fills set, second breaks on zero new paths');
  assert.equal(res.offers.length, 20);
});

test('fetchWorkday — safety cap fires at 50 pages per term with warning', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ offset: body.offset });
    if (calls.length > 500) throw new Error('runaway — guard 3 not implemented yet');
    const postings = Array.from({ length: 20 }, (_, i) => ({
      externalPath: `/job/fresh-${body.offset + i}`,
      title: `T ${body.offset + i}`,
      locationsText: 'Paris',
    }));
    return {
      ok: true,
      status: 200,
      json: async () => ({ jobPostings: postings }),
      text: async () => '',
    };
  };
  restore = () => {
    globalThis.fetch = original;
  };

  const res = await fetchWorkday(
    'https://ten.wd3.myworkdayjobs.com/Site',
    'Tenant',
    { searchTerms: ['x'], pageSize: 20, maxOffers: 5000 }
  );
  assert.equal(calls.length, 50, 'should POST exactly 50 times (safety cap)');
  assert.equal(res.offers.length, 1000);
  assert.ok(
    res.warnings.some((w) => /hit page cap/.test(w)),
    'warnings should include page-cap notice'
  );
});

test('fetchWorkday — Criteo-like mock terminates with bounded POST count', async () => {
  const original = globalThis.fetch;
  const calls = [];

  const TERM_FIXTURES = {
    Intern: { total: 107, pages: 6 },
    Internship: { total: 47, pages: 3 },
    Stage: { total: 20, pages: 1, wrap: true },
    Stagiaire: { total: 5, pages: 1 },
    Apprenti: { total: 2, pages: 1 },
  };

  function responseFor(searchText, offset) {
    const fx = TERM_FIXTURES[searchText];
    if (!fx) return { total: 0, jobPostings: [] };

    if (fx.wrap) {
      const postings = Array.from({ length: 20 }, (_, i) => ({
        externalPath: `/job/${searchText}-wrap-${i}`,
        title: `${searchText} Title ${i}`,
        locationsText: 'Paris',
      }));
      const total = offset === 0 ? fx.total : 0;
      return { total, jobPostings: postings };
    }

    const pageIndex = offset / 20;
    if (pageIndex >= fx.pages) return { total: fx.total, jobPostings: [] };

    const remaining = fx.total - offset;
    const count = Math.min(20, remaining);
    const postings = Array.from({ length: count }, (_, i) => ({
      externalPath: `/job/${searchText}-${offset + i}`,
      title: `${searchText} Title ${offset + i}`,
      locationsText: 'Paris',
    }));
    return { total: fx.total, jobPostings: postings };
  }

  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ offset: body.offset, term: body.searchText });
    if (calls.length > 500) throw new Error('runaway — integration test exceeded bound');
    const payload = responseFor(body.searchText, body.offset);
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => '',
    };
  };
  restore = () => {
    globalThis.fetch = original;
  };

  const res = await fetchWorkday(
    'https://criteo.wd3.myworkdayjobs.com/Criteo_Career_Site',
    'Criteo'
  );
  assert.ok(calls.length <= 30, `POST count should be ≤ 30, got ${calls.length}`);
  assert.ok(res.offers.length > 0 && res.offers.length <= 200);
  assert.equal(res.warnings.length, 0, 'no page-cap warning expected for this scenario');
});
