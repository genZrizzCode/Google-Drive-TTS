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

function sendMessageToTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
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
    if (!pageUrl.includes('drive.google.com') && !pageUrl.includes('docs.google.com')) {
      setStatus('Open a PDF in Google Drive first, then try again.', true);
      return;
    }

    const result = await sendMessageToTab(tab.id, { type: 'EXTRACT_PDF_TEXT' });
    if (!result?.ok) {
      setStatus(result?.error || 'Could not extract text.', true);
      return;
    }

    const text = (result.text || '').trim();
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
