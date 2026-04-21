export function interpretProbeResult({
  navigateResult,
  findResult,
  findError = null,
  navigateError = null,
} = {}) {
  if (navigateError || !navigateResult) {
    if (navigateError && /ERR_ABORTED|net::|failed to navigate/i.test(String(navigateError))) {
      return { ok: false, reason: 'navigation_failed', detail: String(navigateError) };
    }
    if (!navigateResult) {
      return { ok: false, reason: 'navigation_failed', detail: 'no navigate result' };
    }
  }
  if (findError) {
    const msg = String(findError);
    if (/manifest must request permission/i.test(msg)) {
      return { ok: false, reason: 'missing_permission', detail: msg };
    }
    if (/extension.*not.*installed|no response from extension|extension.*disconnected/i.test(msg)) {
      return { ok: false, reason: 'extension_not_installed', detail: msg };
    }
    if (/timeout/i.test(msg)) {
      return { ok: false, reason: 'timeout', detail: msg };
    }
    return { ok: false, reason: 'unknown', detail: msg };
  }
  if (!findResult) {
    return { ok: false, reason: 'unknown', detail: 'no find result and no error' };
  }
  return { ok: true };
}

export async function probeExtensionPermission(
  client,
  { probeHost = 'https://jobs.lever.co/anthropic', findSelector = 'body' } = {}
) {
  let navigateResult = null;
  let navigateError = null;
  let findResult = null;
  let findError = null;
  try {
    navigateResult = await client.navigate(probeHost);
  } catch (err) {
    navigateError = err?.message ?? String(err);
  }
  if (navigateError || !navigateResult) {
    return interpretProbeResult({ navigateResult, navigateError, findResult, findError });
  }
  try {
    findResult = await client.find(findSelector);
  } catch (err) {
    findError = err?.message ?? String(err);
  }
  return interpretProbeResult({ navigateResult, navigateError, findResult, findError });
}
