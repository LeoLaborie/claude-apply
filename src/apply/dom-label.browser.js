// Browser-side DOM helpers. Plain JS, no imports/exports. Two entry points:
//   extractLabel(el)               -> best human label for a form element
//   clickInQuestion(qText, choice) -> scoped click on a radio/checkbox
// Must work both when injected into a live page (via javascript_tool) and when
// evaluated inside jsdom via `new Function(src + "; return extractLabel;")`.

function extractLabel(el) {
  if (!el) return '';
  var isChoice = el.type === 'radio' || el.type === 'checkbox';
  if (isChoice) {
    var qLever = el.closest && el.closest('.application-question');
    if (qLever) {
      var lt = qLever.querySelector('.text, .application-question-text');
      if (lt && lt.textContent && lt.textContent.trim()) return lt.textContent.trim();
    }
    var qAsh = el.closest && el.closest('[data-qa="question"]');
    if (qAsh) {
      var at = qAsh.querySelector('[data-qa="label"]');
      if (at && at.textContent && at.textContent.trim()) return at.textContent.trim();
    }
  }
  if (el.id) {
    var _win = el.ownerDocument && el.ownerDocument.defaultView;
    var _cssEscape =
      (_win && _win.CSS && _win.CSS.escape) ||
      (typeof CSS !== 'undefined' && CSS.escape) ||
      function (s) {
        return String(s).replace(/"/g, '\\"');
      };
    const byFor = el.ownerDocument.querySelector('label[for="' + _cssEscape(el.id) + '"]');
    if (byFor && byFor.textContent) {
      const t = byFor.textContent.trim();
      if (t) return t;
    }
  }
  const wrap = el.closest && el.closest('label');
  if (wrap && wrap.textContent) {
    const t = wrap.textContent.trim();
    if (t) return t;
  }
  const aria = el.getAttribute && el.getAttribute('aria-label');
  if (aria && aria.trim()) return aria.trim();
  const ariaBy = el.getAttribute && el.getAttribute('aria-labelledby');
  if (ariaBy) {
    const ref = el.ownerDocument.getElementById(ariaBy);
    if (ref && ref.textContent) {
      const t = ref.textContent.trim();
      if (t) return t;
    }
  }
  const lever = el.closest && el.closest('.application-question');
  if (lever) {
    const t = lever.querySelector('.text, .application-question-text');
    if (t && t.textContent && t.textContent.trim()) return t.textContent.trim();
  }
  const gh = el.closest && el.closest('.field');
  if (gh) {
    const t = gh.querySelector('label');
    if (t && t.textContent && t.textContent.trim()) return t.textContent.trim();
  }
  const ash = el.closest && el.closest('[data-qa="question"]');
  if (ash) {
    const t = ash.querySelector('[data-qa="label"]');
    if (t && t.textContent && t.textContent.trim()) return t.textContent.trim();
  }
  return '';
}

function clickInQuestion(questionText, choiceLabel, root) {
  var doc = (root && root.ownerDocument) || document;
  var scope = root || doc;
  var needle = String(questionText || '')
    .trim()
    .toLowerCase();
  var choice = String(choiceLabel || '')
    .trim()
    .toLowerCase();
  if (!needle) throw new Error('clickInQuestion: empty questionText');
  if (!choice) throw new Error('clickInQuestion: empty choiceLabel');

  var containers = Array.prototype.slice.call(
    scope.querySelectorAll('.application-question, [data-qa="question"], .field')
  );
  var q = containers.find(function (el) {
    var header = el.querySelector('.text, .application-question-text, [data-qa="label"], label');
    var text = (header && header.textContent) || '';
    return text.trim().toLowerCase().indexOf(needle) !== -1;
  });
  if (!q) throw new Error('clickInQuestion: question not found: ' + questionText);

  var labels = Array.prototype.slice.call(q.querySelectorAll('label'));
  var target = labels.find(function (l) {
    return (l.textContent || '').trim().toLowerCase() === choice;
  });
  if (!target) {
    throw new Error(
      'clickInQuestion: choice "' + choiceLabel + '" not found in question "' + questionText + '"'
    );
  }
  if (target.htmlFor) {
    var input = doc.getElementById(target.htmlFor);
    if (input) {
      input.checked = true;
      if (typeof input.click === 'function') input.click();
    }
  } else {
    target.click();
  }
  return {
    question: (q.textContent || '').trim().slice(0, 80),
    choice: choiceLabel,
  };
}
