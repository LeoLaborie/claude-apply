import { checkTitle, checkBlacklist } from '../lib/prefilter-rules.mjs';

const SAMPLE_PER_REASON = 10;
const TOP_COMPANIES = 20;

export function simulate(filter, rows) {
  const whitelist = {
    positive: filter.positive || [],
    negative: filter.negative || [],
    required_any: filter.required_any || [],
  };
  const blacklist = filter.blacklist || [];

  const rejectedByReason = new Map();
  const sampleRejected = new Map();
  const companyAgg = new Map();

  let accepted = 0;
  for (const row of rows) {
    const offer = { title: row.title || '', company: row.company || '' };
    let reason = null;

    const t = checkTitle(offer, whitelist);
    if (!t.pass) {
      reason = t.reason;
    } else {
      const b = checkBlacklist(offer, blacklist);
      if (!b.pass) reason = b.reason;
    }

    const co = row.company || '(unknown)';
    const agg = companyAgg.get(co) || { company: co, accepted: 0, rejected: 0 };
    if (reason === null) {
      accepted += 1;
      agg.accepted += 1;
    } else {
      agg.rejected += 1;
      rejectedByReason.set(reason, (rejectedByReason.get(reason) || 0) + 1);
      const list = sampleRejected.get(reason) || [];
      if (list.length < SAMPLE_PER_REASON) {
        list.push({ title: row.title, company: row.company, portal: row.portal });
        sampleRejected.set(reason, list);
      }
    }
    companyAgg.set(co, agg);
  }

  const total = rows.length;
  const byCompany = [...companyAgg.values()]
    .sort((a, b) => b.accepted - a.accepted || b.rejected - a.rejected)
    .slice(0, TOP_COMPANIES);

  return {
    total,
    accepted,
    ratio: total === 0 ? 0 : accepted / total,
    rejectedByReason,
    sampleRejected,
    byCompany,
  };
}
