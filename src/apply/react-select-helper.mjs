export class ReactSelectError extends Error {
  constructor(code, message, { found } = {}) {
    super(message);
    this.name = 'ReactSelectError';
    this.code = code;
    this.found = found;
  }
}

export function matchOptionText(options, target) {
  if (!Array.isArray(options) || options.length === 0) return null;
  const t = String(target).trim();
  const tLower = t.toLowerCase();

  for (const opt of options) {
    if (String(opt).trim() === t) return opt;
  }
  for (const opt of options) {
    if (String(opt).trim().toLowerCase() === tLower) return opt;
  }
  for (const opt of options) {
    if (String(opt).trim().toLowerCase().startsWith(tLower)) return opt;
  }
  return null;
}

export const REACT_SELECT_SNIPPET = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const control =
    document.querySelector(controlSelector) ||
    document.querySelector(controlSelector + ' .select__control');
  if (!control) {
    return { ok: false, code: 'CONTROL_NOT_FOUND' };
  }

  const fire = (el, type) =>
    el.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }),
    );

  fire(control, 'mousedown');
  fire(control, 'mouseup');

  const container =
    control.closest('[class*="select__container"]') ||
    control.parentElement ||
    document;

  let menu = null;
  for (let i = 0; i < 30; i++) {
    menu =
      container.querySelector('.select__menu') ||
      document.querySelector('.select__menu');
    if (menu) break;
    await sleep(50);
  }
  if (!menu) {
    return { ok: false, code: 'MENU_NOT_OPENED' };
  }

  const optionEls = Array.from(menu.querySelectorAll('.select__option'));
  const labels = optionEls.map((el) => (el.textContent || '').trim());
  const target = String(optionText).trim();
  const targetLower = target.toLowerCase();

  let matchIdx = labels.findIndex((l) => l === target);
  if (matchIdx < 0)
    matchIdx = labels.findIndex((l) => l.toLowerCase() === targetLower);
  if (matchIdx < 0)
    matchIdx = labels.findIndex((l) =>
      l.toLowerCase().startsWith(targetLower),
    );

  if (matchIdx < 0) {
    return { ok: false, code: 'OPTION_NOT_FOUND', found: labels };
  }

  const option = optionEls[matchIdx];
  fire(option, 'mousedown');
  fire(option, 'mouseup');
  option.click();

  const matchedLabel = labels[matchIdx];
  const matchedLower = matchedLabel.toLowerCase();
  const valueMatches = (text) => {
    const v = (text || '').trim();
    if (!v) return false;
    const vLower = v.toLowerCase();
    return (
      v === matchedLabel ||
      vLower === matchedLower ||
      vLower === targetLower ||
      vLower.startsWith(targetLower) ||
      matchedLower.startsWith(vLower)
    );
  };

  let appliedValue = '';
  for (let i = 0; i < 10; i++) {
    const valueEls = Array.from(
      container.querySelectorAll(
        '.select__single-value, .select__multi-value__label',
      ),
    );
    const hit = valueEls.find((el) => valueMatches(el.textContent));
    if (hit) {
      appliedValue = hit.textContent.trim();
      break;
    }
    await sleep(50);
  }
  if (!appliedValue) {
    return { ok: false, code: 'SELECTION_NOT_APPLIED', found: labels };
  }

  return { ok: true, value: appliedValue };
})()`;
