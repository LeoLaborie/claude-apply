import fs from 'node:fs';
import { parseDocument, isSeq } from 'yaml';

export class AddCompanyError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'AddCompanyError';
    this.code = code;
    this.details = details;
  }
}

export function appendCompany(portalsPath, entry) {
  const raw = fs.readFileSync(portalsPath, 'utf8');
  const doc = parseDocument(raw);
  if (doc.errors.length > 0) {
    throw new AddCompanyError('SHAPE_INVALID', 'portals.yml parse failed', { errors: doc.errors });
  }

  const list = doc.get('tracked_companies', true);
  if (!isSeq(list)) {
    throw new AddCompanyError('SHAPE_INVALID', 'tracked_companies is not a sequence');
  }

  const node = doc.createNode({
    name: entry.name,
    careers_url: entry.careersUrl,
    enabled: true,
  });
  list.add(node);

  const out = String(doc);
  const reparsed = parseDocument(out);
  if (reparsed.errors.length > 0) {
    throw new AddCompanyError('POST_PARSE_FAILED', 'post-mutation reparse failed', {
      errors: reparsed.errors,
    });
  }

  fs.writeFileSync(portalsPath, out);
  return {
    entryIndex: list.items.length - 1,
    total: list.items.length,
    entry: {
      name: entry.name,
      careers_url: entry.careersUrl,
      enabled: true,
    },
  };
}
