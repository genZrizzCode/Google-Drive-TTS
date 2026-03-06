'use strict';

const CLEAN_WHITESPACE = /\s+/g;
const UI_NOISE_PATTERNS = [
  /^(open|open with|share|download|print|rename|details|comments|zoom|find|keyboard shortcuts)$/i,
  /^page\s+\d+\s*(of|\/)\s*\d+$/i,
  /^loading[.…]*$/i,
  /^google (docs|drive)$/i,
  /^(copy link|get embed link|email this file)$/i,
  /^(anyone with the link|this document is owned by someone outside your organization)/i
];

function normalizeText(value) {
  return value.replace(CLEAN_WHITESPACE, ' ').trim();
}

function isProbablyUiNoise(text) {
  if (!text) {
    return true;
  }

  if (text.length > 2000 && text.startsWith('{') && text.includes('"mimeType"')) {
    return true;
  }

  if (/^\d+$/.test(text) || /^[\d\s/]+$/.test(text)) {
    return true;
  }

  if (/\d{4,}/.test(text) && !/[a-z]/i.test(text)) {
    return true;
  }

  return UI_NOISE_PATTERNS.some((pattern) => pattern.test(text));
}

function getTextFromPdfTextLayers() {
  const selectors = [
    '.textLayer span',
    '[class*="textLayer"] span',
    '[class*="text-layer"] span'
  ];

  const results = [];

  for (const selector of selectors) {
    const nodes = document.querySelectorAll(selector);
    for (const node of nodes) {
      const text = normalizeText(node.textContent || '');
      if (text && !isProbablyUiNoise(text)) {
        results.push(text);
      }
    }
    if (results.length > 500) {
      break;
    }
  }

  return results;
}

function dedupeChunks(chunks) {
  const seen = new Set();
  const result = [];

  for (const chunk of chunks) {
    const key = chunk.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(chunk);
    }
  }

  return result;
}

function extractPdfText() {
  const layerText = dedupeChunks(getTextFromPdfTextLayers());
  if (layerText.length) {
    return layerText.join(' ');
  }

  const fallbackRaw = normalizeText(document.body.innerText || '');
  if (!fallbackRaw) {
    return '';
  }

  const lines = fallbackRaw
    .split('\n')
    .map((line) => normalizeText(line))
    .filter((line) => line && !isProbablyUiNoise(line));

  if (!lines.length) {
    return '';
  }

  return lines.join(' ');
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'EXTRACT_PDF_TEXT') {
    return;
  }

  try {
    const text = extractPdfText();
    if (!text) {
      sendResponse({
        ok: false,
        error: 'No readable PDF text layer found. This file may be scanned/image-only or still loading.'
      });
      return;
    }

    sendResponse({ ok: true, text });
  } catch (error) {
    sendResponse({ ok: false, error: String(error) });
  }
});
