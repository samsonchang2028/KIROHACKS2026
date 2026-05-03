// pipeline.js — Orchestration layer for the senior accessibility assistant
// Entry point: handleQuery(userMessage) → { speak, action, requiresConfirmation }
//
// This file is the only place that imports both llm.js and screenshot.js.
// It validates LLM output, clamps parameters, and maps to the stub contract shape.

'use strict';

// --- Task 4.1: Action allowlist and confirmation set ---

// Hard-coded allowlist — the LLM is never trusted to produce valid action names.
// Any action not in this list is treated as no_match and logged as a security event.
const ALLOWED_ACTIONS = [
    'setTextSize',
    'setBrightness',
    'setVolume',
    'openApp',
    'openWebsite',
    'closeApp',
    'closeActiveWindow',
    'closeScamPopup',
    'readScreenAloud',
    'sendHelpToFamily',
    // Control actions — not executed as system actions
    'needs_screenshot',
    'no_match',
    'clarify',
    'explain_last_action',
    'checkPerformance',
];

// Actions that require user confirmation before execution.
// readScreenAloud, setBrightness, setVolume are considered trivial/reversible — no confirmation needed.
const REQUIRES_CONFIRMATION = new Set([
    'setTextSize',
    'openApp',
    'openWebsite',
    'closeApp',
    'closeActiveWindow',
    'closeScamPopup',
    'sendHelpToFamily',
]);

// Non-executable control actions — these return action: null in the stub contract
const NON_EXECUTABLE = new Set(['needs_screenshot', 'no_match', 'clarify', 'explain_last_action', 'checkPerformance']);

/**
 * Validates an action string against the allowlist.
 * Returns the action if it's in ALLOWED_ACTIONS, or 'no_match' otherwise.
 *
 * @param {string} str
 * @returns {string}
 */
function validateAction(str) {
    if (ALLOWED_ACTIONS.includes(str)) {
        return str;
    }
    return 'no_match';
}

// --- Task 4.2: Parameter clamping helpers ---

/**
 * Clamps a numeric value to the range [0, 100].
 * Returns 50 as a safe default for non-numeric input.
 *
 * @param {*} value
 * @returns {number} — always in [0, 100]
 */
function clampLevel(value) {
    if (typeof value !== 'number' || !isFinite(value)) {
        return 50; // safe default for non-numbers and non-finite values
    }
    return Math.min(100, Math.max(0, value));
}

/**
 * Snaps a value to the nearest valid text scale: [100, 125, 150, 175, 200].
 * Returns 150 as a safe default for invalid (non-finite, non-numeric) input.
 *
 * @param {*} value
 * @returns {100|125|150|175|200}
 */
function nearestScale(value) {
    const VALID_SCALES = [100, 125, 150, 175, 200];

    if (typeof value !== 'number' || !isFinite(value)) {
        return 150; // safe default
    }

    // Find the scale with the smallest absolute distance
    let nearest = VALID_SCALES[0];
    let minDist = Math.abs(value - nearest);

    for (let i = 1; i < VALID_SCALES.length; i++) {
        const dist = Math.abs(value - VALID_SCALES[i]);
        if (dist < minDist) {
            minDist = dist;
            nearest = VALID_SCALES[i];
        }
    }

    return nearest;
}

// --- Task 4.6: handleQuery implementation ---

// Lazy-load llm and screenshot so the module can be required in test contexts
// where those modules may be mocked or unavailable.
let llm = require('./llm');
let screenshot = require('./screenshot');
const { checkSystem } = require('../system-monitor');

// --- Screenshot cache (in-memory only, ZDR — never written to disk) ---
// Populated by stubs.js wrapping executeAction with before/after captures.
// Cleared when the session ends (app close). Never shown in the UI.
const screenshotCache = [];

function pushScreenshotEntry(entry) {
    screenshotCache.push(entry);
}

async function explainLastAction() {
    if (screenshotCache.length === 0) {
        return "I haven't done anything yet this session.";
    }
    const last = screenshotCache[screenshotCache.length - 1];
    if (!last.before || !last.after) {
        return `I ran "${last.action}" but I don't have screenshots to show you what changed.`;
    }
    return llm.explainScreenshotDiff(last.before, last.after, last.action);
}

function _isExplainQuery(msg) {
    const lower = (msg || '').toLowerCase();
    return (
        lower.includes('what just happened') ||
        lower.includes('what did you do') ||
        lower.includes('what changed') ||
        lower.includes('what did that do') ||
        lower.includes('what was that') ||
        lower.includes('explain what you did') ||
        lower.includes("i don't understand") ||
        lower.includes("i dont understand") ||
        lower.includes('confused') ||
        lower.includes('what happened')
    );
}



// --- Conversation history (in-memory only, never written to disk) ---
// Keeps the last few exchanges so the LLM can handle follow-ups and clarifications.
// Cleared when the app closes — no persistence across sessions.
const MAX_HISTORY = 10; // max messages to keep (user + assistant pairs)
let conversationHistory = [];

function addToHistory(role, content) {
    conversationHistory.push({ role, content });
    // Trim to keep only the last MAX_HISTORY messages
    if (conversationHistory.length > MAX_HISTORY) {
        conversationHistory = conversationHistory.slice(-MAX_HISTORY);
    }
}

function clearHistory() {
    conversationHistory = [];
}

/**
 * Main pipeline entry point. Called from main.js IPC handler.
 *
 * @param {string} userMessage
 * @returns {Promise<{ speak: string, action: { name: string, params: object }|null, requiresConfirmation: boolean }>}
 * Never throws — all errors are caught and converted to a safe user-facing reply.
 */
async function handleQuery(userMessage) {
    try {
        // Add user message to conversation history
        addToHistory('user', userMessage);



        // Step 1: Text query with conversation history
        let parsed = await llm.textQuery(userMessage, conversationHistory.slice(0, -1));

        // Step 2: If the LLM needs a screenshot, capture and re-query with vision
        if (parsed.action === 'needs_screenshot') {
            let base64 = null;
            try {
                base64 = await screenshot.capture();
            } catch (screenshotErr) {
                // Screenshot failure is non-fatal — proceed without it
                console.error('[LLM ERROR] screenshot capture failed, proceeding without screenshot:', screenshotErr.message);
            }

            // Call vision query (with or without screenshot — if null, pass empty string)
            parsed = await llm.visionQuery(userMessage, base64 || '', conversationHistory.slice(0, -1));
        }

        // Step 3: Validate action against allowlist — never trust LLM output
        const rawAction = parsed.action;
        const validatedAction = validateAction(rawAction);

        if (validatedAction !== rawAction) {
            console.error(`[LLM ERROR] security: unexpected action "${rawAction}" — replacing with no_match`);
        }

        const action = validatedAction;

        // Handle explain_last_action — LLM detected user confusion about a recent action
        if (action === 'explain_last_action') {
            const explanation = await explainLastAction().catch(() =>
                "I'm not sure what happened — something may have gone wrong."
            );
            addToHistory('assistant', explanation);
            return {
                speak: explanation,
                action: null,
                requiresConfirmation: false,
                suggestions: [],
            };
        }
        const reply = parsed.reply || 'Done.';
        let params = parsed.params || null;

        // Step 4: Apply parameter clamping/validation
        if (action === 'setBrightness' && params && typeof params.level !== 'undefined') {
            params = { ...params, level: clampLevel(params.level) };
        } else if (action === 'setVolume' && params && typeof params.level !== 'undefined') {
            params = { ...params, level: clampLevel(params.level) };
        } else if (action === 'setTextSize' && params && typeof params.scale !== 'undefined') {
            params = { ...params, scale: nearestScale(params.scale) };
        }

        // Step 5: Map to stub contract shape
        // Non-executable actions (needs_screenshot, no_match, clarify) return action: null
        const executableAction = NON_EXECUTABLE.has(action)
            ? null
            : { name: action, params };

        // For checkPerformance, run the system monitor and return suggestions
        let suggestions = [];
        if (action === 'checkPerformance') {
            try {
                suggestions = checkSystem() || [];
                console.log('[pipeline] checkPerformance: suggestions:', suggestions);
            } catch (sysErr) {
                console.error('[pipeline] checkSystem error:', sysErr.message);
            }
        }

        // Add assistant reply to conversation history
        addToHistory('assistant', reply);

        return {
            speak: reply,
            action: executableAction,
            requiresConfirmation: REQUIRES_CONFIRMATION.has(action),
            suggestions,
        };

    } catch (err) {
        // Catch-all — the IPC handler must never see a raw exception
        console.error('[LLM ERROR] handleQuery uncaught error:', err.message);
        return {
            speak: 'I had trouble with that. Please try again.',
            action: null,
            requiresConfirmation: false,
            suggestions: [],
        };
    }
}

module.exports = { handleQuery, clearHistory, validateAction, clampLevel, nearestScale, ALLOWED_ACTIONS, REQUIRES_CONFIRMATION, pushScreenshotEntry };

// =============================================================================
// Property tests — run with: node pipeline.js  (from senior-assistant/llm-integration/)
// =============================================================================
if (require.main === module) {
    (async () => {
        let allPassed = true;

        // -----------------------------------------------------------------------
        // Task 4.3 — Property 1: Action allowlist enforcement
        // -----------------------------------------------------------------------
        {
            const validInputs = [...ALLOWED_ACTIONS];
            const invalidInputs = [
                'DROP TABLE',
                '',
                'rm -rf /',
                'a'.repeat(1000),
                "'; DROP TABLE users; --",
                '<script>alert(1)</script>',
                'undefined',
                'null',
                'constructor',
                '__proto__',
                'eval',
                'setTextSize; rm -rf /',
                '0',
                '   ',
                'SETTEXTSIZE', // wrong case
                'set_text_size',
            ];

            let passed = true;
            let failDetails = [];

            for (const str of validInputs) {
                const result = validateAction(str);
                // Valid actions must return themselves
                if (result !== str) {
                    passed = false;
                    failDetails.push(`validateAction("${str}") returned "${result}", expected "${str}"`);
                }
            }

            for (const str of invalidInputs) {
                const result = validateAction(str);
                // Invalid actions must return 'no_match'
                if (result !== 'no_match') {
                    passed = false;
                    failDetails.push(`validateAction("${str}") returned "${result}", expected "no_match"`);
                }
                // Result must always be in ALLOWED_ACTIONS
                if (!ALLOWED_ACTIONS.includes(result)) {
                    passed = false;
                    failDetails.push(`validateAction("${str}") returned "${result}" which is NOT in ALLOWED_ACTIONS`);
                }
            }

            // Invariant: result is always in ALLOWED_ACTIONS
            for (const str of [...validInputs, ...invalidInputs]) {
                const result = validateAction(str);
                if (!ALLOWED_ACTIONS.includes(result)) {
                    passed = false;
                    failDetails.push(`INVARIANT VIOLATION: validateAction("${str}") = "${result}" not in ALLOWED_ACTIONS`);
                }
            }

            if (passed) {
                console.log('[PASS] Property 1: Action allowlist enforcement');
            } else {
                console.error('[FAIL] Property 1: Action allowlist enforcement');
                failDetails.forEach((d) => console.error('  ', d));
                allPassed = false;
            }
        }

        // -----------------------------------------------------------------------
        // Task 4.4 — Property 3: Numeric parameter clamping
        // -----------------------------------------------------------------------
        {
            const testInputs = [
                -999, -1, 0, 50, 100, 101, 999,
                0.5, 99.9,
                NaN, Infinity, -Infinity,
                null, undefined, 'string',
                {}, [], true, false,
            ];

            let passed = true;
            let failDetails = [];

            for (const input of testInputs) {
                const result = clampLevel(input);
                if (typeof result !== 'number') {
                    passed = false;
                    failDetails.push(`clampLevel(${JSON.stringify(input)}) returned non-number: ${result}`);
                } else if (result < 0 || result > 100) {
                    passed = false;
                    failDetails.push(`clampLevel(${JSON.stringify(input)}) = ${result} is outside [0, 100]`);
                } else if (!isFinite(result)) {
                    passed = false;
                    failDetails.push(`clampLevel(${JSON.stringify(input)}) = ${result} is not finite`);
                }
            }

            if (passed) {
                console.log('[PASS] Property 3: Numeric parameter clamping');
            } else {
                console.error('[FAIL] Property 3: Numeric parameter clamping');
                failDetails.forEach((d) => console.error('  ', d));
                allPassed = false;
            }
        }

        // -----------------------------------------------------------------------
        // Task 4.5 — Property 4: setTextSize scale validation
        // -----------------------------------------------------------------------
        {
            const VALID_SCALES = [100, 125, 150, 175, 200];
            const testInputs = [
                -100, 0, 50, 99, 100, 112, 125, 137, 150, 162, 175, 187, 200, 201, 999,
                NaN, null, 'string',
                Infinity, -Infinity, undefined, {}, [],
            ];

            let passed = true;
            let failDetails = [];

            for (const input of testInputs) {
                const result = nearestScale(input);
                if (!VALID_SCALES.includes(result)) {
                    passed = false;
                    failDetails.push(`nearestScale(${JSON.stringify(input)}) = ${result} is not in [100, 125, 150, 175, 200]`);
                }
            }

            if (passed) {
                console.log('[PASS] Property 4: setTextSize scale validation');
            } else {
                console.error('[FAIL] Property 4: setTextSize scale validation');
                failDetails.forEach((d) => console.error('  ', d));
                allPassed = false;
            }
        }

        // -----------------------------------------------------------------------
        // Task 4.7 — Property 2: Pipeline never throws to caller
        // -----------------------------------------------------------------------
        {
            const errors = [
                new Error('Network error: ECONNREFUSED'),
                new SyntaxError('Unexpected token < in JSON at position 0'),
                Object.assign(new Error('HTTP 500: Internal Server Error'), { status: 500 }),
                new TypeError('Cannot read properties of undefined'),
                new Error('Request timeout after 4000ms'),
            ];

            let passed = true;
            let failDetails = [];

            // Save original llm reference so we can restore it
            const originalLlm = llm;

            for (const err of errors) {
                // Temporarily replace llm.textQuery with a throwing function
                llm = { ...originalLlm, textQuery: async () => { throw err; } };

                try {
                    const result = await handleQuery('test message');

                    // Must return an object — never throw
                    if (typeof result !== 'object' || result === null) {
                        passed = false;
                        failDetails.push(`handleQuery returned non-object for error "${err.message}": ${result}`);
                        continue;
                    }

                    // Must have all three required fields
                    if (typeof result.speak === 'undefined') {
                        passed = false;
                        failDetails.push(`handleQuery missing "speak" field for error "${err.message}"`);
                    }
                    if (!('action' in result)) {
                        passed = false;
                        failDetails.push(`handleQuery missing "action" field for error "${err.message}"`);
                    }
                    if (typeof result.requiresConfirmation === 'undefined') {
                        passed = false;
                        failDetails.push(`handleQuery missing "requiresConfirmation" field for error "${err.message}"`);
                    }
                } catch (unexpectedThrow) {
                    passed = false;
                    failDetails.push(`handleQuery THREW for error "${err.message}": ${unexpectedThrow.message}`);
                }
            }

            // Restore original llm
            llm = originalLlm;

            if (passed) {
                console.log('[PASS] Property 2: Pipeline never throws');
            } else {
                console.error('[FAIL] Property 2: Pipeline never throws');
                failDetails.forEach((d) => console.error('  ', d));
                allPassed = false;
            }
        }

        // -----------------------------------------------------------------------
        // Task 4.8 — Property 6: Reply field always present and non-empty
        // -----------------------------------------------------------------------
        {
            let passed = true;
            let failDetails = [];

            const originalLlm = llm;
            const originalScreenshot = screenshot;

            // Test cases: various LLM response shapes and error paths
            const testCases = [
                {
                    label: 'normal setTextSize response',
                    mockTextQuery: async () => ({ action: 'setTextSize', params: { scale: 150 }, reply: 'Making your text bigger.' }),
                },
                {
                    label: 'no_match response',
                    mockTextQuery: async () => ({ action: 'no_match', params: null, reply: 'I can only help with volume, brightness, text size, and opening apps.' }),
                },
                {
                    label: 'clarify response',
                    mockTextQuery: async () => ({ action: 'clarify', params: { question: 'Which app?' }, reply: 'Which app would you like me to open?' }),
                },
                {
                    label: 'error path — textQuery throws',
                    mockTextQuery: async () => { throw new Error('Network error'); },
                },
                {
                    label: 'empty string userMessage',
                    mockTextQuery: async () => ({ action: 'no_match', params: null, reply: 'I can only help with volume, brightness, text size, and opening apps.' }),
                    userMessage: '',
                },
                {
                    label: 'null userMessage',
                    mockTextQuery: async () => ({ action: 'no_match', params: null, reply: 'I can only help with volume, brightness, text size, and opening apps.' }),
                    userMessage: null,
                },
                {
                    label: 'LLM returns empty reply string',
                    // reply is empty — pipeline should still return a non-empty speak
                    mockTextQuery: async () => ({ action: 'setVolume', params: { level: 50 }, reply: '' }),
                },
                {
                    label: 'LLM returns missing reply field',
                    mockTextQuery: async () => ({ action: 'setVolume', params: { level: 50 } }),
                },
            ];

            for (const tc of testCases) {
                llm = { ...originalLlm, textQuery: tc.mockTextQuery };
                screenshot = originalScreenshot;

                const msg = tc.userMessage !== undefined ? tc.userMessage : 'test message';

                try {
                    const result = await handleQuery(msg);

                    if (typeof result.speak !== 'string' || result.speak.length === 0) {
                        passed = false;
                        failDetails.push(`[${tc.label}] speak is empty or not a string: ${JSON.stringify(result.speak)}`);
                    }
                } catch (unexpectedThrow) {
                    passed = false;
                    failDetails.push(`[${tc.label}] handleQuery threw unexpectedly: ${unexpectedThrow.message}`);
                }
            }

            // Restore
            llm = originalLlm;
            screenshot = originalScreenshot;

            if (passed) {
                console.log('[PASS] Property 6: Reply field always present');
            } else {
                console.error('[FAIL] Property 6: Reply field always present');
                failDetails.forEach((d) => console.error('  ', d));
                allPassed = false;
            }
        }

        // -----------------------------------------------------------------------
        // Task 4.9 — Property 5: Vision path only triggered by needs_screenshot
        // -----------------------------------------------------------------------
        {
            let passed = true;
            let failDetails = [];

            const originalLlm = llm;
            const originalScreenshot = screenshot;

            // Test every possible action value
            const allActions = [...ALLOWED_ACTIONS];

            for (const actionValue of allActions) {
                let screenshotCalled = false;

                // Mock screenshot.capture to track calls
                screenshot = {
                    capture: async () => {
                        screenshotCalled = true;
                        return 'fake-base64-data';
                    },
                };

                // Mock llm: textQuery returns the action, visionQuery returns a safe no_match
                llm = {
                    textQuery: async () => ({
                        action: actionValue,
                        params: null,
                        reply: 'Test reply.',
                    }),
                    visionQuery: async () => ({
                        action: 'no_match',
                        params: null,
                        reply: 'Test vision reply.',
                    }),
                };

                try {
                    await handleQuery('test message');
                } catch (err) {
                    passed = false;
                    failDetails.push(`handleQuery threw for action "${actionValue}": ${err.message}`);
                    continue;
                }

                const shouldHaveCaptured = actionValue === 'needs_screenshot';

                if (shouldHaveCaptured && !screenshotCalled) {
                    passed = false;
                    failDetails.push(`action="${actionValue}": screenshot.capture() was NOT called but should have been`);
                } else if (!shouldHaveCaptured && screenshotCalled) {
                    passed = false;
                    failDetails.push(`action="${actionValue}": screenshot.capture() WAS called but should NOT have been`);
                }
            }

            // Restore
            llm = originalLlm;
            screenshot = originalScreenshot;

            if (passed) {
                console.log('[PASS] Property 5: Vision path only triggered by needs_screenshot');
            } else {
                console.error('[FAIL] Property 5: Vision path only triggered by needs_screenshot');
                failDetails.forEach((d) => console.error('  ', d));
                allPassed = false;
            }
        }

        // -----------------------------------------------------------------------
        // Summary
        // -----------------------------------------------------------------------
        console.log('');
        if (allPassed) {
            console.log('[PASS] All property tests passed.');
        } else {
            console.error('[FAIL] One or more property tests failed.');
            process.exit(1);
        }
    })();
}
