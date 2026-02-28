# Drive PDF Reader (Chrome Extension)

Reads text from Google Drive PDF viewer pages and speaks it with Chrome TTS.

## Load in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose this folder: `extension/`.

## Use

1. Open a PDF in Google Drive (`drive.google.com` or `docs.google.com`).
2. Click the extension icon.
3. Click **Read Current PDF**.
4. Click **Stop** to stop speech.

## Notes

- Extraction quality depends on whether Google Drive exposes a text layer for that PDF.
- Scanned-image PDFs without OCR may not produce readable text.
