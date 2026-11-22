#!/usr/bin/env node
// fetch_url: fetch a public URL and return its text content. Text content
// types only, with a size cap and a timeout. Never sends credentials.
// Contract: ai/tools/fetch_url.yaml
import {ToolError, checkInput, enforceRole, main} from './_lib.mjs';

export const TOOL_ID = 'fetch_url';
export const ALLOWED_ROLES = ['orchestrator', 'architect', 'security'];
export const TIMEOUT_SECONDS = 30;
export const UNDERLYING_COMMAND = 'GET <url>';

const INPUT = {
  type: 'object',
  properties: {
    url: {type: 'string'},
    maxChars: {type: 'integer', minimum: 1000, maximum: 100000, default: 20000},
  },
  required: ['url'],
  additionalProperties: false,
};

const TEXT_TYPES = [/^text\//, /\/json$/, /\+json$/, /\/xml$/, /\+xml$/];

await main(async (input, role) => {
  enforceRole(role, ALLOWED_ROLES);
  checkInput(input, INPUT);
  let parsed;
  try {
    parsed = new URL(input.url);
  } catch {
    throw new ToolError('INVALID_URL', 'Invalid URL. Use a full http or https URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ToolError('INVALID_URL', 'Invalid URL. Use a public http or https URL.');
  }
  if (parsed.username || parsed.password) {
    throw new ToolError('INVALID_URL', 'URLs with embedded credentials are refused.');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_SECONDS * 1000);
  let res;
  try {
    res = await fetch(input.url, {signal: ctrl.signal, headers: {Accept: 'text/*, application/json, application/xml;q=0.9', 'User-Agent': 'wekyt-fetch-url/0.4.0'}});
  } catch (e) {
    if (e.name === 'AbortError') throw new ToolError('FETCH_TIMEOUT', 'Fetch timed out. Try a smaller page, or check the URL.', true);
    throw new ToolError('FETCH_FAILED', `Fetch failed: ${e.message}`, true);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new ToolError('FETCH_FAILED', `Fetch failed with status ${res.status}.`, res.status >= 500);
  }
  const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!TEXT_TYPES.some((re) => re.test(contentType))) {
    throw new ToolError('UNSUPPORTED_CONTENT_TYPE', `Content type ${contentType || 'unknown'} is not text. Fetch it with a tool that understands its format.`);
  }
  const declaredLength = Number(res.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > 5000000) {
    throw new ToolError('RESPONSE_TOO_LARGE', 'Response is larger than 5 MB. Fetch a smaller page.');
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  const maxChars = input.maxChars;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxChars) {
        chunks.push(value.subarray(0, Math.max(0, maxChars - (total - value.length))));
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
  } catch (e) {
    throw new ToolError('FETCH_FAILED', `Fetch failed while reading the body: ${e.message}`, true);
  }
  const buf = Buffer.concat(chunks);
  return {url: res.url, status: res.status, contentType, content: buf.toString('utf8'), bytes: buf.length, truncated};
});
