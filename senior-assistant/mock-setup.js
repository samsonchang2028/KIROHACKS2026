// Preload script: sets up env vars and mocks electron before pipeline.js loads
// Used with: node --require ./mock-setup.js llm-integration/pipeline.js

process.env.OPENROUTER_API_KEY = 'placeholder-for-property-tests';

const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
        return {
            desktopCapturer: {
                getSources: async () => []
            }
        };
    }
    return originalLoad.apply(this, arguments);
};
