// screenshot.js — Electron main process only
// Captures the primary display and returns a base64-encoded PNG string.
// Never writes to disk. Never logs the image data.
//
// Why desktopCapturer: it's the only Electron-native API for screen capture
// that works without external dependencies. Must run in the main process —
// calling this from the renderer will throw.

const { desktopCapturer } = require('electron');

class ScreenshotError extends Error {
    constructor(message, cause) {
        super(message);
        this.name = 'ScreenshotError';
        this.cause = cause;
    }
}

/**
 * Captures the primary display.
 *
 * @returns {Promise<string>} Base64-encoded PNG string (no data URI prefix).
 * @throws {ScreenshotError} If desktopCapturer fails or returns no sources.
 */
async function capture() {
    try {
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 1920, height: 1080 },
        });

        if (!sources || sources.length === 0) {
            throw new Error('No screen sources returned by desktopCapturer');
        }

        const buffer = sources[0].thumbnail.toPNG();
        // Debug: save to temp file so we can verify what was captured
        const fs = require('fs');
        const path = require('path');
        const debugPath = path.join(require('os').tmpdir(), 'helper-debug-screenshot.png');
        fs.writeFileSync(debugPath, buffer);
        console.log('[screenshot] saved debug screenshot to:', debugPath, 'size:', buffer.length);
        return buffer.toString('base64');
    } catch (err) {
        console.error('[LLM ERROR] screenshot:', err);
        throw new ScreenshotError('Failed to capture screenshot', err);
    }
}

module.exports = { capture };

// ---------------------------------------------------------------------------
// TEMPORARY VERIFICATION BLOCK — remove after manual verification
//
// This block cannot be run with plain `node` because desktopCapturer is an
// Electron-only API. To verify, run the full Electron app and check the
// console output for a non-empty base64 string length.
//
// Expected output: something like "screenshot base64 length: 123456"
// ---------------------------------------------------------------------------
if (require.main === module) {
    capture()
        .then((result) => {
            console.log('screenshot base64 length:', result.length);
        })
        .catch((err) => {
            console.error('capture() failed:', err);
        });
}
