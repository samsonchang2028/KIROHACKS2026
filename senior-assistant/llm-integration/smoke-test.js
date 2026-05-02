// smoke-test.js — Demo smoke test for the LLM integration pipeline
// Run with: node --require ./mock-setup.js llm-integration/smoke-test.js  (from senior-assistant/)
//
// Tests:
//   1. Text path: 'make my text bigger' → action.name === 'setTextSize'
//   2. Screenshot path: 'what is on my screen' → screenshot.capture() invoked
//   3. Error resilience: '' (empty string) → non-empty speak field, no throw
//
// All LLM calls are mocked — no real API key needed.

'use strict';

// ---------------------------------------------------------------------------
// Mock setup: intercept require('./llm') and require('./screenshot') so that
// pipeline.js uses our controllable fakes instead of the real modules.
// ---------------------------------------------------------------------------

// State that tests can mutate between calls
const mockState = {
    textQueryFn: null,
    visionQueryFn: null,
    captureCallCount: 0,
    captureBase64: 'AAAA'.repeat(100), // fake base64 data (400 chars)
};

const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

// Paths we want to intercept (resolved relative to pipeline.js location)
const llmResolved = require.resolve('./llm');
const screenshotResolved = require.resolve('./screenshot');

Module._load = function (request, parent, isMain) {
    // Resolve the request relative to the parent to get the absolute path
    let resolved;
    try {
        resolved = Module._resolveFilename(request, parent, isMain);
    } catch {
        resolved = null;
    }

    if (resolved === llmResolved) {
        return {
            textQuery: async (...args) => {
                if (mockState.textQueryFn) return mockState.textQueryFn(...args);
                throw new Error('textQuery mock not configured');
            },
            visionQuery: async (...args) => {
                if (mockState.visionQueryFn) return mockState.visionQueryFn(...args);
                throw new Error('visionQuery mock not configured');
            },
        };
    }

    if (resolved === screenshotResolved) {
        return {
            capture: async () => {
                mockState.captureCallCount++;
                console.log(`  [INFO] screenshot.capture() called, base64 length: ${mockState.captureBase64.length}`);
                return mockState.captureBase64;
            },
        };
    }

    return originalLoad.apply(this, arguments);
};

// Now require pipeline — it will get our mocked llm and screenshot
const pipeline = require('./pipeline');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function pass(label, detail) {
    console.log(`[PASS] ${label}${detail ? ' — ' + detail : ''}`);
    passed++;
}

function fail(label, detail) {
    console.error(`[FAIL] ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

(async () => {
    // -------------------------------------------------------------------------
    // Test 1 — Text path
    // Mock textQuery to return setTextSize action
    // Assert action.name === 'setTextSize'
    // -------------------------------------------------------------------------
    mockState.textQueryFn = async () => ({
        action: 'setTextSize',
        params: { scale: 150 },
        reply: 'Making your text bigger.',
    });
    mockState.visionQueryFn = null;
    mockState.captureCallCount = 0;

    try {
        const result = await pipeline.handleQuery('make my text bigger');
        const actionName = result && result.action && result.action.name;

        if (actionName === 'setTextSize') {
            pass('Test 1 — text path', `action.name = "${actionName}", speak = "${result.speak}"`);
        } else {
            fail('Test 1 — text path', `expected action.name "setTextSize", got ${JSON.stringify(actionName)}. Full result: ${JSON.stringify(result)}`);
        }
    } catch (err) {
        fail('Test 1 — text path', `threw unexpectedly: ${err.message}`);
    }

    // -------------------------------------------------------------------------
    // Test 2 — Screenshot path
    // Mock textQuery to return needs_screenshot, then visionQuery returns readScreenAloud
    // Assert screenshot.capture() was invoked
    // -------------------------------------------------------------------------
    mockState.textQueryFn = async () => ({
        action: 'needs_screenshot',
        params: null,
        reply: 'Let me look.',
    });
    mockState.visionQueryFn = async () => ({
        action: 'readScreenAloud',
        params: null,
        reply: 'I see your desktop.',
    });
    mockState.captureCallCount = 0;

    try {
        const result = await pipeline.handleQuery('what is on my screen');

        if (mockState.captureCallCount > 0) {
            pass('Test 2 — screenshot path', `screenshot.capture() was invoked (base64 length: ${mockState.captureBase64.length}), speak = "${result.speak}"`);
        } else {
            fail('Test 2 — screenshot path', `screenshot.capture() was NOT called. result: ${JSON.stringify(result)}`);
        }
    } catch (err) {
        fail('Test 2 — screenshot path', `threw unexpectedly: ${err.message}`);
    }

    // -------------------------------------------------------------------------
    // Test 3 — Error resilience
    // Mock textQuery to throw an error
    // Assert result has a non-empty speak field and does not throw
    // -------------------------------------------------------------------------
    mockState.textQueryFn = async () => {
        throw new Error('Simulated network failure');
    };
    mockState.visionQueryFn = null;
    mockState.captureCallCount = 0;

    try {
        const result = await pipeline.handleQuery('');
        const hasValidSpeak = result && typeof result.speak === 'string' && result.speak.length > 0;

        if (hasValidSpeak) {
            pass('Test 3 — error resilience', `speak = "${result.speak}"`);
        } else {
            fail('Test 3 — error resilience', `speak is empty or missing. result: ${JSON.stringify(result)}`);
        }
    } catch (err) {
        fail('Test 3 — error resilience', `threw unexpectedly: ${err.message}`);
    }

    // -------------------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------------------
    console.log('');
    console.log(`Results: ${passed} passed, ${failed} failed`);

    if (failed > 0) {
        process.exit(1);
    }
})();
