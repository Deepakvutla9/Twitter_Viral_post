const test = require('node:test');
const assert = require('node:assert/strict');

process.env.GROQ_API_KEY = 'test-key';
process.env.GROQ_MODEL = 'global/default-model';

// Capture what model the SDK is actually asked for.
const groqPath = require.resolve('groq-sdk');
let lastPayload = null;
require.cache[groqPath] = {
  id: groqPath, filename: groqPath, loaded: true,
  exports: class {
    constructor() {
      this.chat = {
        completions: {
          create: async (payload) => {
            lastPayload = payload;
            return { choices: [{ message: { content: JSON.stringify({
              slides: [
                { type: 'hook', badge: 'NEWS', teaser: 'What? →' },
                { type: 'detail', body: `${'word '.repeat(80)}**a highlighted phrase**.` },
              ],
              caption: 'Hook. And a question?',
              imagePrompt: 'scene',
              hashtags: ['#a', '#b', '#c', '#d', '#e'],
            }) } }] };
          },
        },
      };
    }
  },
};

const { generateOnce } = require('./gemini');

const ARTICLE = { title: 'T', source: 'S', fullText: 'Body text with 4,200 roles.' };
const ACCOUNT = (extra) => ({ slug: 'x', handle: '@x', displayName: 'X', accent: '#00e5ff', voice: {}, hashtagExtra: [], ...extra });

test.beforeEach(() => { lastPayload = null; });

test('an account model overrides the global one', async () => {
  await generateOnce(ARTICLE, 'T', null, ACCOUNT({ groqModel: 'account/special-model' }));
  assert.equal(lastPayload.model, 'account/special-model');
});

test('an account without a model still uses the global default', async () => {
  await generateOnce(ARTICLE, 'T', null, ACCOUNT({ groqModel: null }));
  assert.equal(lastPayload.model, 'global/default-model');
});

test('the account still reaches generation end to end', async () => {
  // The caption's own hashtag behaviour is covered in branding.test.js, where
  // relevance can be controlled. Here it is enough that the account threads
  // through and a caption comes back.
  const out = await generateOnce(ARTICLE, 'T', null, ACCOUNT({ hashtagExtra: ['#HouseTag'] }));
  assert.match(lastPayload.messages[1].content, /#housetag/i, 'the tag reached the prompt');
  assert.ok(out.caption.length > 0);
});
