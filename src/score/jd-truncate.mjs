// Heuristic JD truncation: keep Responsibilities / Requirements / Qualifications,
// drop Benefits / About us / Equal opportunity. Hard cap on token estimate.

export function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

const KEEP_HEADERS =
  /^\s*#{0,3}\s*(responsibilities|what you.?ll do|requirements|qualifications|must have|nice to have|skills|your role|missions|profil|ce que tu feras|compétences)\b/im;
const DROP_HEADERS =
  /^\s*#{0,3}\s*(about us|benefits|perks|equal opportunity|diversity|how to apply|apply now|our story|who we are|why join|pourquoi nous rejoindre|avantages)\b/im;

function splitSections(text) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  let current = [];
  for (const line of lines) {
    if (/^\s*$/.test(line) && current.length > 0) {
      sections.push(current.join('\n'));
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) sections.push(current.join('\n'));
  return sections;
}

export function truncateJd(text, maxTokens = 1500) {
  if (!text) return '';
  if (estimateTokens(text) <= maxTokens) return text.trim();

  const sections = splitSections(text);
  const keep = [];
  const maybe = [];
  for (const s of sections) {
    if (DROP_HEADERS.test(s)) continue;
    if (KEEP_HEADERS.test(s)) keep.push(s);
    else maybe.push(s);
  }

  let out = keep.join('\n\n');
  if (estimateTokens(out) < maxTokens * 0.5) {
    for (const s of maybe) {
      if (estimateTokens(out + '\n\n' + s) > maxTokens) break;
      out += '\n\n' + s;
    }
  }

  // Fallback: no sections matched at all — use truncated prefix of original text
  if (!out.trim()) {
    const cap = maxTokens * 4;
    out = text.trim().slice(0, cap);
    return out.trim();
  }

  const cap = maxTokens * 4;
  if (out.length > cap) out = out.slice(0, cap);
  return out.trim();
}
