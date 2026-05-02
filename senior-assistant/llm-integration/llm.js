// llm.js — OpenRouter API calls for the senior accessibility assistant
// Exports: textQuery(userMessage), visionQuery(userMessage, screenshotBase64)

'use strict';

// --- Task 3.1: Module setup ---

// Load API key at module load time — fail fast if missing
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) {
    throw new Error(
        '[LLM] OPENROUTER_API_KEY is not set. ' +
        'Add it to your .env file and load dotenv before requiring this module.'
    );
}

// System prompt — copied verbatim from design doc
const SYSTEM_PROMPT = `You are an accessibility assistant for seniors. You help with exactly 8 actions.

Respond ONLY with valid JSON. No markdown. No explanation outside the JSON.

ALLOWED ACTIONS:
- setTextSize(scale)     scale must be one of: 100, 125, 150, 175, 200
- setBrightness(level)   level 0–100, ALWAYS return params as {"level": <number>}
- setVolume(level)       level 0–100, ALWAYS return params as {"level": <number>} (mute = 0, full = 100)
- openApp(name)          name is a string like "chrome" or "notepad"
- closeActiveWindow()    no params
- closeScamPopup()       no params
- readScreenAloud()      no params
- sendHelpToFamily(summary)  summary is a short string

RESPONSE FORMAT:
{"action": "<action_name>", "params": <params_or_null>, "reply": "<warm short sentence for the user>"}

SPECIAL ACTIONS (not system actions):
- If you need to see the screen to answer: {"action": "needs_screenshot", "params": null, "reply": "Let me take a look at your screen first."}
- If the request doesn't match any action: {"action": "no_match", "params": null, "reply": "I can only help with volume, brightness, text size, and opening apps."}
- If the request is ambiguous: {"action": "clarify", "params": {"question": "..."}, "reply": "..."}
- After seeing a screenshot: describe what you see on screen (name the apps/windows you can identify). Then ask the user what they'd like help with. Use clarify. For example: {"action": "clarify", "params": {"question": "I can see VS Code, Chrome, and a dark terminal window. Which one would you like me to help with?"}, "reply": "I can see VS Code, Chrome, and a dark terminal window. Which one would you like me to help with?"}
- When the user refers to something on screen (like "the dark window" or "that popup"), use your memory of the screenshot to figure out which app they mean, then take the appropriate action. For example if they say "close the dark window" and you saw a dark terminal, use closeActiveWindow.
- Do NOT take action automatically after seeing a screenshot — always describe and ask first.

RULES:
- Never suggest actions outside the list above.
- Never include code, commands, or URLs in your response.
- The reply field must be warm, short (under 25 words), and spoken aloud to the user.
- If the user mentions multiple problems, handle the most urgent one first and mention you'll help with the rest next. For example: "I'll close that scary popup first. Then we can fix your text size."
- If the user mentions a popup, virus warning, or scary message, use closeScamPopup.
- If the user mentions text being small or hard to read, use setTextSize with scale 150 as a safe default.
- For openApp: if the app name looks misspelled or you're not sure what app they mean, use clarify to ask. For example "open drrrcket" should respond with clarify: "Did you mean DrRacket?" When the user confirms, use openApp with the corrected name.
- params must ALWAYS be a JSON object like {"level": 80} or {"name": "chrome"}, never a bare string or number.`;

// Shared request headers — sent on every OpenRouter request
// x-or-policy: no-training ensures zero data retention (primary privacy control)
const HEADERS = {
    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://github.com/hackathon/senior-assistant',
    'X-Title': 'Senior Accessibility Assistant',
    'x-or-policy': 'no-training',
};

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Shared request options applied to both text and vision calls
const SHARED_OPTIONS = {
    max_tokens: 256,
    temperature: 0.1,
    response_format: { type: 'json_object' },
};

// --- Task 3.2: textQuery ---

/**
 * Send a text-only message to the LLM and return the parsed JSON response.
 * Uses anthropic/claude-3-haiku via OpenRouter.
 *
 * @param {string} userMessage
 * @param {Array} history — previous conversation messages [{role, content}, ...]
 * @returns {Promise<{ action: string, params: object|null, reply: string }>}
 * @throws on non-2xx HTTP status or JSON parse failure
 */
async function textQuery(userMessage, history = []) {
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history,
        { role: 'user', content: userMessage },
    ];

    const body = {
        model: 'anthropic/claude-3-haiku',
        messages,
        ...SHARED_OPTIONS,
    };

    const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        throw new Error(`[LLM] textQuery HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    const raw = data.choices[0].message.content;

    // JSON.parse throws on malformed content — pipeline.js catches this
    return JSON.parse(raw);
}

// --- Task 3.3: visionQuery ---

/**
 * Send a message + screenshot to the vision-capable LLM and return the parsed JSON response.
 * Uses openai/gpt-4o-mini via OpenRouter.
 *
 * @param {string} userMessage
 * @param {string} screenshotBase64 — raw base64 PNG string (no data URI prefix)
 * @param {Array} history — previous conversation messages [{role, content}, ...]
 * @returns {Promise<{ action: string, params: object|null, reply: string }>}
 * @throws on non-2xx HTTP status or JSON parse failure
 */
async function visionQuery(userMessage, screenshotBase64, history = []) {
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history,
        {
            role: 'user',
            content: [
                { type: 'text', text: userMessage },
                { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotBase64}` } },
            ],
        },
    ];

    const body = {
        model: 'openai/gpt-4o-mini',
        messages,
        ...SHARED_OPTIONS,
    };

    const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        throw new Error(`[LLM] visionQuery HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    const raw = data.choices[0].message.content;

    return JSON.parse(raw);
}

module.exports = { textQuery, visionQuery };

// --- Task 3.4: Verification block (TEMPORARY — remove after verification) ---
// Run with: node llm-integration/llm.js  (from senior-assistant/)
if (require.main === module) {
    (async () => {
        console.log('[LLM verify] Calling textQuery("make my text bigger")...');
        try {
            const result = await textQuery('make my text bigger');
            console.log('[LLM verify] Raw response:', JSON.stringify(result, null, 2));

            // Verify the returned object has the expected fields
            const hasAction = 'action' in result;
            const hasParams = 'params' in result;
            const hasReply = 'reply' in result;

            console.log(`[LLM verify] action  present: ${hasAction}`);
            console.log(`[LLM verify] params  present: ${hasParams}`);
            console.log(`[LLM verify] reply   present: ${hasReply}`);

            if (hasAction && hasParams && hasReply) {
                console.log('[LLM verify] ✓ All required fields present — llm.js is working correctly.');
            } else {
                console.error('[LLM verify] ✗ One or more required fields missing.');
                process.exit(1);
            }
        } catch (err) {
            console.error('[LLM verify] ✗ Error:', err.message);
            process.exit(1);
        }
    })();
}
