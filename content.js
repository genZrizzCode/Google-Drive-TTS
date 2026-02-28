'use strict';

const CLEAN_WHITESPACE = /\s+/g;

function normalizeText(value) {
  return value.replace(CLEAN_WHITESPACE, ' ').trim();
}

function getTextFromTextLayers() {
  const selectors = [
    '.textLayer span',
    '[class*="textLayer"] span',
    '[class*="text-layer"] span',
    '[aria-label*="Page"] span',
    '[aria-label*="page"] span'
  ];

  const results = [];

  for (const selector of selectors) {
    const nodes = document.querySelectorAll(selector);
    for (const node of nodes) {
      const text = normalizeText(node.textContent || '');
      if (text) {
        results.push(text);
      }
    }
    if (results.length > 200) {
      break;
    }
  }

  return results;
}

function getFallbackText() {
  // Clone body so cleanup does not modify the live Drive/Docs page.
  const clonedBody = document.body?.cloneNode(true);
  if (!clonedBody) {
    return '';
  }

  const blockedSelectors = [
    'script',
    'style',
    'noscript',
    'button',
    'svg',
    'path',
    'header',
    'footer',
    '[role="toolbar"]',
    '[aria-label*="toolbar"]'
  ];

  for (const selector of blockedSelectors) {
    clonedBody.querySelectorAll(selector).forEach((el) => el.remove());
  }

  const text = normalizeText(clonedBody.innerText || '');
  return text;
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
  const layerText = dedupeChunks(getTextFromTextLayers());
  if (layerText.length) {
    return layerText.join(' ');
  }

  return getFallbackText();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'EXTRACT_PDF_TEXT') {
    return;
  }

  try {
    const text = extractPdfText();
    if (!text) {
      sendResponse({ ok: false, error: 'No readable text found on this page.' });
      return;
    }

    sendResponse({ ok: true, text });
  } catch (error) {
    sendResponse({ ok: false, error: String(error) });
  }
});
