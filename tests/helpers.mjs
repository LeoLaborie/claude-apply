// Mock fetch helper for ATS tests.
// Usage:
//   const restore = installMockFetch({
//     'https://api.lever.co/v0/postings/mistral?mode=json': fixtureJson,
//   });
//   ... run test ...
//   restore();

export function installMockFetch(urlMap) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const key = typeof url === 'string' ? url : url.toString();
    if (!(key in urlMap)) {
      throw new Error(`mockFetch: unexpected URL ${key}`);
    }
    const value = urlMap[key];
    if (value instanceof Error) throw value;
    if (typeof value === 'object' && value !== null && 'status' in value) {
      // Allow specifying {status, body} for error cases
      return {
        ok: value.status >= 200 && value.status < 300,
        status: value.status,
        json: async () => value.body,
        text: async () => JSON.stringify(value.body),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => value,
      text: async () => JSON.stringify(value),
    };
  };
  return () => {
    globalThis.fetch = original;
  };
}
