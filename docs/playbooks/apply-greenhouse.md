# react-select custom dropdown playbook

This playbook is read by the agent during `/apply` step 5 when the DOM contains any `.select__control` element on a required field. It is **not Greenhouse-specific** — the same helper works on Ashby and any site using [react-select](https://react-select.com). It is stored under `apply-greenhouse.md` because that is where the bug was first hit (issue #41, Doctolib Greenhouse).

## Why a dedicated path

`form_input` writes `input.value` directly, which react-select ignores. The React native-setter pattern from `.claude/commands/apply.md` step 5 also fails because react-select does not render its options until `mousedown` opens the menu, and its selection state lives in React state rather than on a native input.

## Primary path — inject `REACT_SELECT_SNIPPET`

Import the snippet constant from `src/apply/react-select-helper.mjs` (Node-side, via the agent's orchestration) or copy it verbatim. Then run via `mcp__claude-in-chrome__javascript_tool`, binding `controlSelector` and `optionText` in the eval preamble:

```js
const controlSelector = '#some-field .select__control';
const optionText = 'Non';
// then paste REACT_SELECT_SNIPPET here (it reads the two bindings above)
```

The snippet returns one of:

- `{ ok: true, value: 'Non' }` — selection applied; verify `value` matches `optionText` before moving on.
- `{ ok: false, code: 'CONTROL_NOT_FOUND' }`
- `{ ok: false, code: 'MENU_NOT_OPENED' }`
- `{ ok: false, code: 'OPTION_NOT_FOUND', found: [...] }`
- `{ ok: false, code: 'SELECTION_NOT_APPLIED' }`

## Error codes

- **`CONTROL_NOT_FOUND`** — `controlSelector` matched nothing. Re-read the DOM with `read_page`, widen or correct the selector, retry once.
- **`MENU_NOT_OPENED`** — `mousedown` did not cause the menu to render within 1500 ms. Typical causes: a portal root outside the container, or a wrapper that swallows events. Fall back to physical click (below).
- **`OPTION_NOT_FOUND`** — the menu opened but no option label matched `optionText`. The `found` array lists what was visible. Map the profile value to a label the page actually offers, or STOP and ask the user.
- **`SELECTION_NOT_APPLIED`** — the option was clicked but `.select__single-value` stayed empty. Fall back to physical click.

After two consecutive failures on the same field, do **not** loop — switch to the fallback.

## Fallback — physical click via `computer`

1. Get the control center coordinates:
   ```js
   const r = document.querySelector(controlSelector).getBoundingClientRect();
   ({
     x: Math.round(r.left + r.width / 2),
     y: Math.round(r.top + r.height / 2),
   });
   ```
2. `mcp__claude-in-chrome__computer` → `left_click` on `(x, y)`.
3. `type` the first 3–5 characters of `optionText` to filter the menu.
4. `key Return` to pick the first highlighted option.
5. Verify via `javascript_tool` that the container's `.select__single-value` text equals `optionText`.
6. If verification fails → **STOP** and ask the user.

## Invariants

- Never guess an option label. If the offered labels don't include a safe value, STOP.
- Never submit the form with `SELECTION_NOT_APPLIED` unresolved on a required field.
- Never disable or bypass react-select's internals (e.g. via `__reactProps$...`). Stick to DOM events.
