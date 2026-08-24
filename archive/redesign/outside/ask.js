// Sends the outside-perspective prompts to non-Anthropic models over OpenCode Go's
// OpenAI-compatible endpoint. No tools, no filesystem access on their side: the models
// see the prompt bytes and nothing else. Zero dependencies, like the rest of the repo.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const ENDPOINT = 'https://opencode.ai/zen/go/v1/chat/completions';
const TIMEOUT_MS = 20 * 60 * 1000; // without this a stalled stream hangs the driver forever
// One model per lab: OpenAI, Zhipu, Alibaba, Moonshot, MiniMax, Tencent. Heterogeneity is the
// point, so no two entries share a lineage. deepseek-v4-pro (truncates mid-answer every run) and
// grok-4.5 (upstream 503) were dropped as broken, not as uninteresting.
const MODELS = ['gpt-5.6-luna', 'glm-5.3', 'qwen3.8-max', 'kimi-k3', 'minimax-m3', 'hy3'];

function apiKey() {
  const env = readFileSync(join(ROOT, '.env'), 'utf8');
  const m = env.match(/^OPENCODE_KEY=(.*)$/m);
  if (!m) throw new Error('OPENCODE_KEY not found in .env');
  return m[1].trim();
}

const sha = (s) => createHash('sha256').update(s).digest('hex');
const readPrompt = (n) => readFileSync(join(HERE, `PROMPT-pass${n}.md`), 'utf8');
const respPath = (pass, model) => join(HERE, 'responses', `pass${pass}-${model}.md`);

// Builds the message list. Pass 2 replays pass 1 as real conversation history, so each
// model critiques its own answer as its own rather than as quoted text.
function messages(pass, model) {
  const msgs = [{ role: 'user', content: readPrompt(1) }];
  if (pass === 2) {
    const prior = readFileSync(respPath(1, model), 'utf8');
    const body = prior
      .replace(/^---\n[\s\S]*?\n---\n\n/, '')          // drop our provenance header
      .replace(/\n\n<details><summary>Model reasoning[\s\S]*$/, ''); // replay the answer, not the scratchpad
    if (/^\*\*ERROR/m.test(body)) throw new Error(`pass 1 for ${model} failed; cannot run pass 2`);
    msgs.push({ role: 'assistant', content: body }, { role: 'user', content: readPrompt(2) });
  }
  return msgs;
}

// effort caps the reasoning phase. Left unset by default; the heavy reasoners blow past the
// gateway's stream limit and end mid-thought without ever emitting an answer, so their retries
// need it. It is recorded in the response header because it changes what produced the answer.
async function ask(model, pass, key, effort, stream = true) {
  const started = Date.now();
  const res = await fetch(ENDPOINT, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model, messages: messages(pass, model), max_tokens: 64000, stream,
      ...(effort ? { reasoning_effort: effort } : {}),
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 400)}`);

  // The gateway cuts long streams. Pass 2 replays a whole pass-1 answer as context, so the
  // request is large enough that streaming frequently dies mid-generation; --no-stream takes the
  // single-response form instead.
  if (!stream) {
    const j = await res.json();
    const m = j.choices?.[0]?.message ?? {};
    return {
      text: m.content ?? '', reasoning: m.reasoning_content ?? '', usage: j.usage ?? null,
      finish: j.choices?.[0]?.finish_reason ?? null,
      seconds: Math.round((Date.now() - started) / 1000),
    };
  }

  let text = '', reasoning = '', usage = null, finish = null, buf = '';
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      let ev;
      try { ev = JSON.parse(data); } catch { continue; }
      const d = ev.choices?.[0];
      if (d?.delta?.content) { text += d.delta.content; process.stdout.write('.'); }
      if (d?.delta?.reasoning_content) reasoning += d.delta.reasoning_content;
      if (d?.finish_reason) finish = d.finish_reason;
      if (ev.usage) usage = ev.usage;
    }
  }
  const think = text.match(/^\s*<think>([\s\S]*?)<\/think>\s*/);
  if (think) { reasoning += think[1]; text = text.slice(think[0].length); }
  return { text, reasoning, usage, finish, seconds: Math.round((Date.now() - started) / 1000) };
}

function save(pass, model, result, error, effort) {
  const promptFile = `PROMPT-pass${pass}.md`;
  const header = [
    '---',
    `model: ${model}`,
    `pass: ${pass}`,
    `endpoint: ${ENDPOINT}`,
    `date: ${new Date().toISOString()}`,
    `prompt: ${promptFile}`,
    `prompt_sha256: ${sha(readPrompt(pass))}`,
    `reasoning_effort: ${effort ?? '(provider default)'}`,
    error ? `error: ${String(error.message).replace(/\n/g, ' ')}` : `finish_reason: ${result.finish}`,
    error ? '' : `tokens: ${JSON.stringify(result.usage)}`,
    error ? '' : `wall_seconds: ${result.seconds}`,
    error ? '' : `truncated: ${result.finish === 'length'}`,
    error ? '' : `reasoning_chars: ${result.reasoning.length}`,
    '---',
    '',
  ].filter((l) => l !== '').join('\n');
  const tail = !error && result.reasoning
    ? `\n\n<details><summary>Model reasoning trace (${result.reasoning.length} chars) — kept because rejected alternatives often live here</summary>\n\n\`\`\`\n${result.reasoning}\n\`\`\`\n\n</details>\n`
    : '';
  const body = error ? `**ERROR — no response.** ${error.message}\n` : result.text + tail;
  writeFileSync(respPath(pass, model), `${header}\n${body}\n`);
}

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
const pass = Number(arg('--pass', '1'));
const only = arg('--model', null);
const effort = arg('--effort', null);
const stream = !argv.includes('--no-stream');
const models = only ? [only] : MODELS;

if (argv.includes('--dry-run')) {
  for (const m of messages(pass, models[0])) console.log(`\n===== ${m.role} =====\n${m.content}`);
  process.exit(0);
}

if (!existsSync(join(HERE, 'responses'))) mkdirSync(join(HERE, 'responses'), { recursive: true });
const key = apiKey();

await Promise.all(models.map(async (model) => {
  try {
    const result = await ask(model, pass, key, effort, stream);
    save(pass, model, result, null, effort);
    console.log(`\n[ok] ${model} pass ${pass}: ${result.text.split(/\s+/).length} words, ${result.seconds}s, finish=${result.finish}`);
  } catch (e) {
    save(pass, model, null, e, effort);
    console.log(`\n[FAIL] ${model} pass ${pass}: ${e.message}`);
  }
}));
