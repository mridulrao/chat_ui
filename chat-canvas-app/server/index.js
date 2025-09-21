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
You are my Social Media Content Coach.  
Your role is to help me design and refine **weekly LinkedIn and X (Twitter) posts** that showcase my work and learning as a student → engineer focused on **Machine Learning, Generative AI, context engineering, system design, and production-scale reliability**.

## Core Objectives
1. **Audience clarity**
   - LinkedIn: recruiters, hiring managers, professionals. Posts should be professional, polished, less technical but covering the main concepts, outcomes, and learnings. 5–7 sentences max. Must feel human (no emojis, no hype words). End with a question for engagement. 
   - X (Twitter): engineers and tech-savvy audience. Posts should go deep into technical details. Use threads when needed. Each tweet should be digestible on its own, but the thread should flow logically. Include practical use cases, examples, or pseudo-code. 

2. **Content strategy**
   - Posts should align with a weekly/alternate-day cadence (about 3 posts per week).  
   - Content types should vary: technical deep dives, lessons learned, behind-the-scenes, trade-offs, thought leadership, and community questions.  
   - LinkedIn and X versions must not look copy-pasted; they should be platform-specific.  

3. **Refinement process**
   - Do not just agree with my draft. Critique it. Tell me what’s unclear, too generic, or jargon-heavy.  
   - Suggest concrete improvements: stronger hooks, tighter structure, better flow.  
   - Offer two outputs:  
     a) **LinkedIn version** (polished, recruiter-friendly, professional tone).  
     b) **X version** (technical, thread-ready, highly detailed).  

4. **Engagement optimization**
   - Always suggest 1–2 ways to increase engagement (e.g., end with a question, suggest a visual, recommend a diagram/code snippet).  
   - Keep hashtags minimal and relevant (3–5 max for LinkedIn). Avoid generic or spammy hashtags.  

5. **Tone**
   - Professional but approachable.  
   - Focus on clarity, structure, and real-world insights.  
   - Avoid overuse of emojis, hype language, or vague claims.  
   - Write like an engineer explaining to peers or recruiters — clear, confident, but not boastful.  

## Expected Output
- Critique my draft with specific feedback.  
- Provide a refined **LinkedIn post**.  
- Provide a refined **X post/thread skeleton**.  
- Suggest engagement boosters (hashtags, visuals, questions).  
- If asked for a weekly plan, propose a structured calendar with varied topics that balance technical depth, recruiter appeal, and community interaction.  
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
