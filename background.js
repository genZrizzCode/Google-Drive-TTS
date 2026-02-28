'use strict';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'SPEAK_TEXT') {
    const text = (message.text || '').trim();
    if (!text) {
      sendResponse({ ok: false, error: 'No text provided.' });
      return;
    }

    chrome.tts.stop();
    chrome.tts.speak(text, {
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      onEvent: (event) => {
        if (event.type === 'error') {
          console.error('TTS error:', event.errorMessage);
        }
      }
    });

    sendResponse({ ok: true });
  }

  if (message?.type === 'STOP_SPEAKING') {
    chrome.tts.stop();
    sendResponse({ ok: true });
  }

  return true;
});
