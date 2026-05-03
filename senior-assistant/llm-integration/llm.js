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
- openWebsite(url)       url is a full URL like "https://amazon.com" — use this when the user wants to visit a website
- closeApp(name)         name is a string like "chrome" or "notepad" — use this when the user wants to close/quit a specific app by name
- closeActiveWindow()    no params — use only when the user says "close this window" without naming a specific app
- closeScamPopup()       no params
- readScreenAloud()      no params
- sendHelpToFamily(summary)  summary is a short string

RESPONSE FORMAT:
{"action": "<action_name>", "params": <params_or_null>, "reply": "<warm short sentence for the user>"}

SPECIAL ACTIONS (not system actions):
- If you need to see the screen to answer: {"action": "needs_screenshot", "params": null, "reply": "Let me take a look at your screen first."}
- If the request doesn't match any action: {"action": "no_match", "params": null, "reply": "I'm not sure how to help with that, but I can adjust your settings, open apps, or open websites."}
- If the user asks what just happened, what you did, what changed, seems confused about a recent action, or uses any variation of those phrases (even with typos): {"action": "explain_last_action", "params": null, "reply": "Let me explain what I just did."}
- If the user says their computer is slow, laggy, frozen, or not working well: {"action": "checkPerformance", "params": null, "reply": "Let me check what's slowing things down."} — ALWAYS use checkPerformance for performance complaints, never clarify or no_match.
- If the request is ambiguous: {"action": "clarify", "params": {"question": "..."}, "reply": "..."}
- After seeing a screenshot: describe what you see on screen. If the user asked about a scam and you see a suspicious popup, gift card request, fake virus warning, or tech support scam, say "Yes, that's a scam" then describe specifically what you see (e.g. "It's a fake virus warning pretending to be from Microsoft" or "That website is asking you to buy gift cards, which is a common scam"). Then say what you'll close. If it looks safe, tell them "No, that looks fine" and describe what you see.
- When the user refers to something on screen (like "the dark window" or "that popup"), use your memory of the screenshot to figure out which app they mean, then take the appropriate action. For example if they say "close the dark window" and you saw a dark terminal, use closeActiveWindow.

RULES:
- Never suggest actions outside the list above.
- Never include code, commands, or URLs in your response.
- The reply field must be warm, short (under 25 words), and spoken aloud to the user. Be practical and direct, not cheesy. For example: "Searching for music videos on YouTube" not "Let's enjoy some music videos together!" Exception: after seeing a screenshot, the reply can be up to 50 words to describe what you see.
- If the user mentions multiple problems, handle the most urgent one first and mention you'll help with the rest next. For example: "I'll close that scary popup first. Then we can fix your text size."
- If the user mentions a popup, virus warning, or scary message AND asks you to close it, use closeScamPopup.
- If the user asks whether something on screen is a scam, suspicious, or safe, use needs_screenshot first to look at the screen before deciding.
- If the user mentions text being small or hard to read, use setTextSize with scale 150 as a safe default.
- For openApp: if the app name looks misspelled or you're not sure what app they mean, use clarify to ask. For example "open drrrcket" should respond with clarify: "Did you mean DrRacket?" When the user confirms, use openApp with the corrected name.
- For openWebsite: if the user asks to open a website, store, or online service (e.g. "open Amazon", "go to YouTube", "open Gmail"), use openWebsite with the full URL. Always use https://. For example "open Amazon" → openWebsite with {"url": "https://www.amazon.com"}. Use openApp only for desktop applications. If the user says "open [browser] and go to [site]" or "open [browser] and [site]", treat it as a single openWebsite action to that site — do NOT use openApp.
- INTENT MAPPING — when the user's request implies a website or online service, use openWebsite:
  - "play music" / "play [artist/song]" / "play some [genre]" → ALWAYS use openWebsite https://open.spotify.com/search/[query] — music requests always go to Spotify
  - "I want to watch a video/something" → openWebsite https://www.youtube.com — if the user mentions a topic (e.g. "music videos", "cat videos", "cooking"), include it as a search: https://www.youtube.com/results?search_query=[topic]
  - "I want to shop/buy something" → openWebsite https://www.amazon.com
  - "check my email" → openWebsite https://mail.google.com
  - "search for X" / "look up X" → openWebsite https://www.google.com/search?q=X
  - "watch a movie/show" → openWebsite https://www.netflix.com
  - "read the news" → openWebsite https://news.google.com
  - If the intent could match multiple services, use clarify. E.g. "I want to watch something" → clarify: "Would you like YouTube, Netflix, or something else?"
- When the user confirms a clarification (e.g. "yeah, Spotify" or "YouTube please"), immediately perform the action — do NOT clarify again. Map their answer to the correct openWebsite URL and execute it.
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
    max_tokens: 512,
    temperature: 0,
    response_format: { type: 'json_object' },
};

// --- Robust JSON parser for LLM output ---
// Haiku sometimes wraps JSON in markdown code fences or adds text around it.
function parseLLMJson(raw) {
    try { return JSON.parse(raw); } catch (_) { }
    // Try extracting JSON from markdown code fences or surrounding text
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
        try { return JSON.parse(match[0]); } catch (_) { }
    }
    throw new Error(`[LLM] Could not parse JSON from response: ${raw.slice(0, 200)}`);
}

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
        throw new Error(`[LLM] textQuery HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    const raw = data.choices[0].message.content;

    // JSON.parse throws on malformed content — pipeline.js catches this
    return parseLLMJson(raw);
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
        model: 'openai/gpt-4o',
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

    return parseLLMJson(raw);
}

/**
 * Explain what changed between a before and after screenshot.
 * Used when the user asks "what just happened?" after an action.
 *
 * @param {string} beforeBase64 — raw base64 PNG before the action
 * @param {string} afterBase64  — raw base64 PNG after the action
 * @param {string} actionName   — the action that was executed (e.g. "setVolume")
 * @returns {Promise<string>}   — plain English explanation for the user
 */
async function explainScreenshotDiff(beforeBase64, afterBase64, actionName) {
    const messages = [
        {
            role: 'system',
            content: 'You are an accessibility assistant for seniors. Look at the two screenshots and describe in 1 simple sentence what changed on the actual desktop — ignore the chat window. Focus on visible changes like volume icons, brightness, open apps, or windows. Keep it under 15 words. Example: "I turned your volume down to zero."',
        },
        {
            role: 'user',
            content: [
                { type: 'text', text: `I just ran the action "${actionName}". Here is the screen before:` },
                { type: 'image_url', image_url: { url: `data:image/png;base64,${beforeBase64}` } },
                { type: 'text', text: 'And here is the screen after:' },
                { type: 'image_url', image_url: { url: `data:image/png;base64,${afterBase64}` } },
                { type: 'text', text: 'What changed on the desktop (not the chat window)? One short sentence.' },
            ],
        },
    ];

    const body = {
        model: 'openai/gpt-4o-mini',
        messages,
        max_tokens: 128,
        temperature: 0,
    };

    const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        throw new Error(`[LLM] explainScreenshotDiff HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    return data.choices[0].message.content.trim();
}

module.exports = { textQuery, visionQuery, explainScreenshotDiff };

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
