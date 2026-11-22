#!/usr/bin/env node
// web_search: search the public web. Default provider is the DuckDuckGo
// Instant Answer API, which needs no key. Set WEKYT_WEB_SEARCH_PROVIDER to
// none and the tool returns NOT_IMPLEMENTED instead of a faked result.
// Contract: ai/tools/web_search.yaml
import {ToolError, checkInput, enforceRole, main} from './_lib.mjs';

export const TOOL_ID = 'web_search';
export const ALLOWED_ROLES = ['orchestrator', 'architect', 'security'];
export const TIMEOUT_SECONDS = 30;
export const UNDERLYING_COMMAND = 'GET https://api.duckduckgo.com/?q={query}&format=json';

const INPUT = {
  type: 'object',
  properties: {
    query: {type: 'string', minLength: 1},
    maxResults: {type: 'integer', minimum: 1, maximum: 20, default: 5},
  },
  required: ['query'],
  additionalProperties: false,
};

async function searchDuckDuckGo(query, maxResults) {
  const base = (process.env.WEKYT_DDG_API_URL || 'https://api.duckduckgo.com').replace(/\/$/, '');
  const url = `${base}/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_SECONDS * 1000);
  let res;
  try {
    res = await fetch(url, {signal: ctrl.signal, headers: {Accept: 'application/json', 'User-Agent': 'wekyt-web-search/0.4.0'}});
  } catch (e) {
    if (e.name === 'AbortError') throw new ToolError('SEARCH_TIMEOUT', 'Web search timed out. Try a narrower query.', true);
    throw new ToolError('SEARCH_FAILED', `Web search request failed: ${e.message}`, true);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new ToolError('SEARCH_FAILED', `Web search request failed with status ${res.status}.`, res.status >= 500);
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new ToolError('SEARCH_FAILED', 'Web search returned an unreadable response.', true);
  }
  const results = [];
  const seen = new Set();
  const push = (title, url, snippet) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    results.push({title: title || url, url, snippet: snippet || ''});
  };
  if (data.AbstractText && data.AbstractURL) {
    push(data.AbstractSource || data.Heading || 'DuckDuckGo', data.AbstractURL, data.AbstractText);
  }
  const topics = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [];
  for (const topic of topics) {
    if (topic.Topics && Array.isArray(topic.Topics)) {
      for (const sub of topic.Topics) {
        if (sub.FirstURL && sub.Text) push(sub.Text, sub.FirstURL, sub.Text);
      }
    } else if (topic.FirstURL && topic.Text) {
      push(topic.Text, topic.FirstURL, topic.Text);
    }
    if (results.length >= maxResults) break;
  }
  return results.slice(0, maxResults);
}

await main(async (input, role) => {
  enforceRole(role, ALLOWED_ROLES);
  checkInput(input, INPUT);
  const provider = (process.env.WEKYT_WEB_SEARCH_PROVIDER || 'duckduckgo').toLowerCase();
  if (provider === 'none') {
    throw new ToolError('NOT_IMPLEMENTED', 'Web search has no provider configured. Set WEKYT_WEB_SEARCH_PROVIDER to duckduckgo, or use the harness search capability.');
  }
  if (provider !== 'duckduckgo') {
    throw new ToolError('NOT_IMPLEMENTED', `Web search provider ${provider} is not supported. Set WEKYT_WEB_SEARCH_PROVIDER to duckduckgo or none.`);
  }
  const results = await searchDuckDuckGo(input.query, input.maxResults);
  return {query: input.query, results};
});
