import fs from 'node:fs';
import { parseDocument } from 'yaml';

export function write(portalsPath, mutations) {
  const text = fs.readFileSync(portalsPath, 'utf8');
  const doc = parseDocument(text);

  if (mutations.title_filter) {
    const tf = mutations.title_filter;
    if (Array.isArray(tf.positive)) doc.setIn(['title_filter', 'positive'], tf.positive);
    if (Array.isArray(tf.negative)) doc.setIn(['title_filter', 'negative'], tf.negative);
    if (Array.isArray(tf.required_any))
      doc.setIn(['title_filter', 'required_any'], tf.required_any);
  }

  if (Array.isArray(mutations.blacklist)) {
    doc.setIn(['blacklist'], mutations.blacklist);
  }

  fs.writeFileSync(portalsPath, doc.toString());
}
