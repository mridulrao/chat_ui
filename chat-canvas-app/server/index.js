// server/index.js
// Minimal Express server that streams OpenAI chat completions via SSE

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import OpenAI from 'openai';
import * as Iron from '@hapi/iron';
import crypto from 'node:crypto';

const app = express();
const port = process.env.PORT || 8787;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// Ensure a robust secret length for Iron by hashing the provided raw secret
const IRON_SECRET_RAW = process.env.IRON_SECRET || process.env.COOKIE_SECRET || 'change-me-dev-secret';
const IRON_SECRET = crypto.createHash('sha256').update(String(IRON_SECRET_RAW)).digest('hex');
const BYOK_COOKIE_NAME = 'byok';
const DEFAULT_TTL_MS = Number(process.env.BYOK_TTL_SECONDS || 2 * 60 * 60) * 1000; // default 2h
if (!OPENAI_API_KEY) {
  console.warn('[server] Warning: OPENAI_API_KEY is not set. Streaming will fail.');
}

const SYSTEM_PROMPT =`
You are Mridul. Your job is to talk, think, and behave like him in every conversation.

PERSONALITY
- Curious, direct, and practical.
- Thinks out loud while asking questions (“so if I do this, would that mean…?”).
- Balances professional, precise communication with casual honesty.
- Sometimes reflective about career, money, happiness, and motivation.
- Prefers structured answers but still keeps a natural conversational flow.

TONE & STYLE
- Friendly but concise. Casual when needed, professional when explaining.
- Uses short openers like “hey, quick question”, “ok so here’s what I think”.
- If something doesn’t work, responds with “still not working” or “ok, so what’s next”.
- Explains ideas step by step, doesn’t overcomplicate.
- Comfortable switching between deep technical detail and big-picture reflection.

BEHAVIOR
- Asks for step-by-step guides, checklists, or improved rewrites.
- Iterates on ideas: “make this more professional”, “expand this”, “now add X”.
- Likes examples, placeholders, and clear instructions.
- Sometimes mixes curiosity with practicality: “what if we try this instead?”
- When reflective, keeps answers grounded and straightforward, not fluffy.

GREETING EXAMPLES
- “Hey, quick question…”
- “Ok, so I was thinking…”
- “Tell me if this makes sense…”

RESPONSE STYLE
- Start with the main point → then breakdown if needed.
- Use lists, short steps, or examples to explain.
- End with a practical next step or suggestion.
- If not sure, think out loud: “I’m not fully sure, but this is how I’d test it…”

SUMMARY
Act as Mridul would: curious, structured, iterative, and reflective. 
Mimic his way of asking, answering, and thinking. 
`;

const resolveModel = (name) => {
  if (!name) return 'gpt-4o-mini';
  if (name === 'gpt40-mini') return 'gpt-4o-mini';
  return name;
};

// Seal a payload into an opaque string
async function sealPayload(payload) {
  return Iron.seal(payload, IRON_SECRET, Iron.defaults);
}

// Unseal and return payload or null if invalid/expired
async function unsealPayload(sealed) {
  try {
    return await Iron.unseal(sealed, IRON_SECRET, Iron.defaults);
  } catch {
    return null;
  }
}

// Safe metadata for logging without exposing key material
function describeKey(k) {
  if (!k) return { prefix: 'none', len: 0 };
  const prefix = k.startsWith('sk-proj-') ? 'sk-proj' : (k.startsWith('sk-') ? 'sk' : 'unknown');
  return { prefix, len: k.length };
}

// Pretty-print the conversation history for a given thread to the terminal
const printThreadHistory = (threadId, model, messages) => {
  const ts = new Date().toISOString();
  const maxLen = 220;
  const oneLine = (s = "") => String(s).replace(/\s+/g, " ").trim();
  const clip = (s = "") => (s.length > maxLen ? s.slice(0, maxLen) + "…" : s);

  console.log(`\n[server] === Thread ${threadId || 'unknown'} @ ${ts} ===`);
  if (model) console.log(`[server] Model: ${model}`);
  console.log(`[server] Messages (${Array.isArray(messages) ? messages.length : 0}):`);
  (messages || []).forEach((m, i) => {
    const role = m?.role || 'unknown';
    const content = clip(oneLine(m?.content || ''));
    console.log(`  ${String(i + 1).padStart(2, '0')} ${role}: ${content}`);
  });
  console.log(`[server] ===========================================\n`);
};

app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// Returns whether a BYOK key is present (masked)
app.get('/api/key/status', async (req, res) => {
  const sealed = req.cookies?.[BYOK_COOKIE_NAME];
  if (!sealed) return res.json({ hasKey: false });
  const data = await unsealPayload(sealed);
  if (!data?.apiKey) return res.json({ hasKey: false });
  const last4 = data.apiKey.slice(-4);
  console.log('[server] /api/key/status -> hasKey: true');
  return res.json({ hasKey: true, last4, createdAt: data.createdAt });
});

// Accepts and stores a user's OpenAI key in an encrypted, HttpOnly cookie
app.post('/api/key', async (req, res) => {
  try {
    const { apiKey, remember } = req.body || {};
    // Accept modern OpenAI keys including project keys (sk-proj-...) which include '-' and '_' characters
    const isValid = typeof apiKey === 'string' && apiKey.startsWith('sk-') && apiKey.length >= 20;
    if (!isValid) {
      console.warn('[server] /api/key validation failed:', { meta: describeKey(apiKey), remember: !!remember });
      return res.status(400).json({ error: 'Invalid key format' });
    }

    // Optionally: verify the key with a light call (disabled by default to avoid latency)
    // try {
    //   const testClient = new OpenAI({ apiKey });
    //   await testClient.models.list({ limit: 1 });
    // } catch (e) {
    //   return res.status(401).json({ error: 'Key verification failed' });
    // }

    const payload = { apiKey, createdAt: new Date().toISOString() };
    console.log('[server] /api/key received:', { meta: describeKey(apiKey), remember: !!remember });
    const sealed = await sealPayload(payload);
    console.log('[server] /api/key sealed payload length:', sealed?.length ?? 0);

    const maxAge = remember === true
      ? 1000 * 60 * 60 * 24 * 30 // 30 days
      : DEFAULT_TTL_MS; // short session by default

    const cookieOpts = {
      httpOnly: true,
      // Only mark Secure in production; in dev (http) Secure cookies would be dropped
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge,
      path: '/',
    };
    res.cookie(BYOK_COOKIE_NAME, sealed, cookieOpts);
    console.log('[server] /api/key set-cookie ok', { opts: { ...cookieOpts, maxAge }, env: process.env.NODE_ENV });

    return res.json({ ok: true, last4: apiKey.slice(-4) });
  } catch (e) {
    console.error('[server] /api/key error:', e?.message, e?.stack);
    return res.status(500).json({ error: 'Failed to save key' });
  }
});

// Clears the BYOK cookie
app.delete('/api/key', async (req, res) => {
  try {
    res.clearCookie(BYOK_COOKIE_NAME, { path: '/' });
    console.log('[server] /api/key cleared cookie');
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to clear key' });
  }
});

app.post('/api/chat/stream', async (req, res) => {
  try {
    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const { messages = [], model, threadId } = req.body || {};
    const chosenModel = resolveModel(model);

    // Log the incoming conversation history for this thread
    printThreadHistory(threadId, chosenModel, messages);

    // Determine effective API key: BYOK cookie -> env fallback
    let effectiveKey = OPENAI_API_KEY;
    const sealed = req.cookies?.[BYOK_COOKIE_NAME];
    if (sealed) {
      const data = await unsealPayload(sealed);
      if (data?.apiKey) {
        effectiveKey = data.apiKey;
        console.log('[server] /api/chat/stream using BYOK cookie');
      }
    }

    if (!effectiveKey) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Missing OpenAI API key' })}\n\n`);
      return res.end();
    }

    // Compose messages with a system prompt at the start
    const chatMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages,
    ];

    const client = new OpenAI({ apiKey: effectiveKey });
    const stream = await client.chat.completions.create({
      model: chosenModel,
      messages: chatMessages,
      temperature: 0.7,
      stream: true,
    });

    for await (const part of stream) {
      const delta = part?.choices?.[0]?.delta?.content || '';
      if (delta) {
        res.write(`data: ${JSON.stringify({ type: 'token', content: delta })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'done', threadId: threadId || null })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[server] /api/chat/stream error:', err);
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err?.message || 'Unknown error' })}\n\n`);
    } catch {}
    res.end();
  }
});

app.listen(port, () => {
  console.log(`[server] Listening on http://localhost:${port}`);
});
