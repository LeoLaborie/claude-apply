import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BROWSER_SRC = fs.readFileSync(path.join(__dirname, 'dom-label.browser.js'), 'utf8');

export const EXTRACT_LABEL_SRC = BROWSER_SRC;

function loadBrowserFns() {
  const fn = new Function(
    BROWSER_SRC + '\nreturn { extractLabel: extractLabel, clickInQuestion: clickInQuestion };'
  );
  return fn();
}

const _fns = loadBrowserFns();

export function extractLabel(el) {
  return _fns.extractLabel(el);
}

export function clickInQuestion(questionText, choiceLabel, root) {
  return _fns.clickInQuestion(questionText, choiceLabel, root);
}
