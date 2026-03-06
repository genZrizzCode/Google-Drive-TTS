'use strict';

const statusEl = document.getElementById('status');
const previewEl = document.getElementById('preview');
const readBtn = document.getElementById('readBtn');
const stopBtn = document.getElementById('stopBtn');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
  statusEl.classList.toggle('active', !isError);
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function extractPdfTextInFrame() {
  const CLEAN_WHITESPACE = /\s+/g;
  const SCRIPT_DUMP_PATTERNS = [
    /window\.WIZ_global_data/i,
    /_docs_flag_initialData/i,
    /DOCS_initialLoadTiming/i,
    /docs-offline-[a-z0-9-]+/i,
    /gaia_session_id/i,
    /AIza[0-9A-Za-z_-]{10,}/
  ];
  const UI_NOISE_PATTERNS = [
    /^page$/i,
    /^page\s+\d+$/i,
    /^(open|open with|share|download|print|rename|details|comments|zoom|find|keyboard shortcuts)$/i,
    /^page\s+\d+\s*(of|\/)\s*\d+$/i,
    /^loading[.…]*$/i,
    /^google (docs|drive)$/i,
    /^(copy link|get embed link|email this file)$/i,
    /^(anyone with the link|this document is owned by someone outside your organization)/i,
    /^(approve|reject|view details|request a review)$/i
  ];

  function normalizeText(value) {
    return String(value || '').replace(CLEAN_WHITESPACE, ' ').trim();
  }

  function isProbablyUiNoise(text) {
    if (!text) {
      return true;
    }

    if (/sync files between the cloud and your computer/i.test(text)) {
      return true;
    }

    if (/^displaying\s+.+\.pdf\b/i.test(text)) {
      return true;
    }

    const pdfRefCount = (text.match(/\.pdf\b/gi) || []).length;
    if (pdfRefCount >= 2) {
      return true;
    }

    if (pdfRefCount === 1 && text.length < 180 && !/[.!?].*[A-Za-z]{4,}/.test(text)) {
      return true;
    }

    if (text.length > 2000 && text.startsWith('{') && text.includes('"mimeType"')) {
      return true;
    }

    if (/^\d+$/.test(text) || /^[\d\s/]+$/.test(text)) {
      return true;
    }

    if (text.length < 2 && !/[a-z]/i.test(text)) {
      return true;
    }

    return UI_NOISE_PATTERNS.some((pattern) => pattern.test(text));
  }

  function isScriptDump(text) {
    if (!text) {
      return false;
    }

    if (SCRIPT_DUMP_PATTERNS.some((pattern) => pattern.test(text))) {
      return true;
    }

    const eqCount = (text.match(/=/g) || []).length;
    const semicolonCount = (text.match(/;/g) || []).length;
    const braceCount = (text.match(/[{}[\]]/g) || []).length;

    // Heuristic: config/script blobs have lots of assignments + syntax punctuation.
    if (eqCount >= 8 && (semicolonCount >= 4 || braceCount >= 10)) {
      return true;
    }

    return false;
  }

  function looksLikeReadableLine(text) {
    if (isProbablyUiNoise(text)) {
      return false;
    }

    if (isScriptDump(text)) {
      return false;
    }

    if (text.length < 24) {
      return false;
    }

    if ((text.match(/\b[A-Za-z]{2,}\b/g) || []).length < 4) {
      return false;
    }

    if (/[{}[\]<>]/.test(text) && text.length < 100) {
      return false;
    }

    return /[a-z]/i.test(text);
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

  function isInsidePdfPage(node) {
    if (!node || typeof node.closest !== 'function') {
      return false;
    }

    return Boolean(node.closest('.page, [data-page-number], [aria-label^="Page "]'));
  }

  function stripUiArtifacts(text) {
    let cleaned = String(text || '');

    cleaned = cleaned.replace(/sync files between the cloud and your computer\.?/gi, ' ');
    cleaned = cleaned.replace(/\bdisplaying\s+[^.]{0,220}\.pdf\.?/gi, ' ');
    cleaned = cleaned.replace(/\bpage\s+\d+\s*(?:of|\/)\s*\d+\b/gi, ' ');
    cleaned = cleaned.replace(
      /\b(?:[A-Za-z0-9_()[\]\-.,']+\s+){0,8}[A-Za-z0-9_()[\]\-.,']+\.pdf\b/gi,
      ' '
    );

    return normalizeText(cleaned);
  }

  function getAllQueryRoots() {
    const roots = [document];
    const seen = new Set([document]);
    const queue = [document.documentElement];

    while (queue.length) {
      const node = queue.shift();
      if (!node) {
        continue;
      }

      if (node.shadowRoot && !seen.has(node.shadowRoot)) {
        seen.add(node.shadowRoot);
        roots.push(node.shadowRoot);
        queue.push(node.shadowRoot);
      }

      if (node.children) {
        for (const child of node.children) {
          queue.push(child);
        }
      }
    }

    return roots;
  }

  const selectors = [
    '.textLayer span',
    '.textLayer div',
    '[class*="textLayer"] span',
    '[class*="textLayer"] div',
    '[class*="text-layer"] span',
    '[class*="text-layer"] div',
    '.pdfViewer .page span',
    '.pdfViewer .page div',
    '[data-page-number] span',
    '[data-page-number] div'
  ];

  const chunks = [];
  const roots = getAllQueryRoots();

  for (const root of roots) {
    for (const selector of selectors) {
      const nodes = root.querySelectorAll(selector);
      for (const node of nodes) {
        if (!isInsidePdfPage(node)) {
          continue;
        }

        const text = normalizeText(node.textContent);
        if (text && !isProbablyUiNoise(text)) {
          chunks.push(text);
        }
      }
    }
  }

  let deduped = dedupeChunks(chunks);
  let text = deduped.join(' ');

  // Some Drive viewer variants do not expose textLayer nodes.
  // In that case, fall back to body text but keep only sentence-like lines.
  if (!text) {
    const raw = document.body?.innerText || '';
    const normalizedRaw = normalizeText(raw);

    // Keep new-line split first, then add segment-based fallbacks for viewer pages
    // that flatten everything into one long line.
    let lines = raw
      .split('\n')
      .map((line) => normalizeText(line))
      .filter(Boolean);

    if (lines.length <= 3 && normalizedRaw) {
      const byPageMarkers = normalizedRaw
        .split(/page\s+\d+\s*(?:of|\/)\s*\d+/gi)
        .map((segment) => normalizeText(segment))
        .filter(Boolean);

      const byUiKeywords = normalizedRaw
        .split(/\b(?:open with|share|download|print|details|comments|find|keyboard shortcuts)\b/gi)
        .map((segment) => normalizeText(segment))
        .filter(Boolean);

      lines = lines.concat(byPageMarkers, byUiKeywords);
    }

    lines = lines.filter((line) => looksLikeReadableLine(line));

    deduped = dedupeChunks(lines);
    text = deduped.join(' ');
  }

  if (isScriptDump(text)) {
    text = '';
    deduped = [];
  }

  const hasPdfDom = roots.some((root) =>
    Boolean(root.querySelector('.textLayer, .pdfViewer, [data-page-number], [class*="textLayer"], [class*="text-layer"]'))
  );
  text = stripUiArtifacts(text);

  const letterCount = (text.match(/[A-Za-z]/g) || []).length;
  const symbolCount = (text.match(/[{}[\];=]/g) || []).length;
  const scriptSignalCount = SCRIPT_DUMP_PATTERNS.reduce(
    (count, pattern) => count + (pattern.test(text) ? 1 : 0),
    0
  );
  const rawLengthScore = text.length;
  const score =
    rawLengthScore +
    (hasPdfDom ? 3000 : 0) +
    letterCount -
    symbolCount * 8 -
    scriptSignalCount * 4000;

  return {
    frameUrl: window.location.href,
    hasPdfDom,
    isScriptDump: isScriptDump(text),
    chunkCount: deduped.length,
    score,
    text
  };
}

async function extractPdfTextFromTab(tabId) {
  let frameResults;
  try {
    frameResults = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: extractPdfTextInFrame
    });
  } catch (error) {
    return {
      ok: false,
      error: `Could not access PDF frame: ${String(error)}`
    };
  }

  const candidates = frameResults
    .map((entry) => ({ frameId: entry.frameId, ...(entry.result || {}) }))
    .filter((result) => !/\/preload\?source=drive/i.test(result.frameUrl || ''))
    .filter((result) => !result.isScriptDump)
    .filter((result) => (result.text || '').trim().length > 0)
    .sort((a, b) => b.score - a.score);

  if (!candidates.length) {
    const debug = frameResults
      .map((entry) => {
        const result = entry.result || {};
        const frameUrl = result.frameUrl || '';
        const pdfFlag = result.hasPdfDom ? 'pdf' : 'nopdf';
        return `f${entry.frameId}:${result.chunkCount || 0}:${pdfFlag}:${frameUrl.slice(0, 40)}`;
      })
      .join(', ');

    return {
      ok: false,
      error: `No readable PDF text found yet. Scroll into page 1 and wait for load. Frames checked: ${debug || 'none'}.`
    };
  }

  const best = candidates[0];
  return { ok: true, text: best.text, frameUrl: best.frameUrl, chunkCount: best.chunkCount };
}

readBtn.addEventListener('click', async () => {
  try {
    setStatus('Looking for text on this PDF...');
    previewEl.value = '';

    const tab = await getActiveTab();
    if (!tab?.id) {
      setStatus('No active tab found.', true);
      return;
    }

    const pageUrl = tab.url || '';
    if (
      !pageUrl.includes('drive.google.com') &&
      !pageUrl.includes('docs.google.com') &&
      !pageUrl.includes('googleusercontent.com')
    ) {
      setStatus('Open a PDF in Google Drive first, then try again.', true);
      return;
    }

    const extraction = await extractPdfTextFromTab(tab.id);
    if (!extraction.ok) {
      setStatus(extraction.error || 'Could not extract text.', true);
      return;
    }

    const text = (extraction.text || '').trim();
    if (!text) {
      setStatus('No readable text was found.', true);
      return;
    }

    previewEl.value = text.slice(0, 8000);
    setStatus('Reading text aloud...');

    const speakResult = await chrome.runtime.sendMessage({ type: 'SPEAK_TEXT', text });
    if (!speakResult?.ok) {
      setStatus(speakResult?.error || 'Could not start speech.', true);
      return;
    }

    setStatus('Now reading. Use Stop to end playback.');
  } catch (error) {
    setStatus(`Error: ${String(error)}`, true);
  }
});

stopBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'STOP_SPEAKING' });
  setStatus('Stopped.');
});

setStatus('Ready');
