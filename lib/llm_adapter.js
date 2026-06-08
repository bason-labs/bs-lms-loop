// lib/llm_adapter.js — provider-agnostic LLM request/response (ES module).

// Pure: neutral chat messages instructing strict-JSON output.
export function buildSolvePrompt({ question, options, context = '' }) {
  const optLines = options.map((o, i) => `${i}. ${o}`).join('\n');
  const system =
    'You are answering a multiple-choice quiz. Use ONLY the provided context when relevant. ' +
    'Reply with STRICT JSON only, no prose: {"answerIndices":[<int>...],"answerText":["..."],"reason":"..."}. ' +
    'answerIndices are zero-based indices into the options list; select ALL correct options.';
  const user = `Context:\n${context || '(none)'}\n\nQuestion:\n${question}\n\nOptions:\n${optLines}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

// Pure: per-provider HTTP request descriptor {url, headers, body}.
export function buildRequest(provider, cfg, messages) {
  const { apiKey, model, baseUrl, temperature = 0 } = cfg;
  const sys = messages.find((m) => m.role === 'system')?.content ?? '';
  const turns = messages.filter((m) => m.role !== 'system');
  switch (provider) {
    case 'openai':
      return {
        url: `${baseUrl || 'https://api.openai.com'}/v1/chat/completions`,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: { model, temperature, messages, response_format: { type: 'json_object' } }
      };
    case 'anthropic':
      return {
        url: `${baseUrl || 'https://api.anthropic.com'}/v1/messages`,
        headers: {
          'content-type': 'application/json', 'x-api-key': apiKey,
          'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: { model, max_tokens: 1024, temperature, system: sys,
          messages: turns.map((m) => ({ role: m.role, content: m.content })) }
      };
    case 'gemini':
      return {
        url: `${baseUrl || 'https://generativelanguage.googleapis.com'}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        headers: { 'content-type': 'application/json' },
        body: {
          systemInstruction: { parts: [{ text: sys }] },
          contents: turns.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig: { temperature }
        }
      };
    case 'custom':
      if (!baseUrl) throw new Error('Custom provider requires a baseUrl');
      return {
        url: `${baseUrl}/v1/chat/completions`,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: { model, temperature, messages }
      };
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// Pure: normalize provider response JSON → text.
export function parseResponse(provider, json) {
  switch (provider) {
    case 'openai':
    case 'custom': return json?.choices?.[0]?.message?.content ?? '';
    case 'anthropic': return (json?.content ?? []).map((b) => b.text ?? '').join('');
    case 'gemini': return (json?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    default: return '';
  }
}

// Pure: lenient extraction of the strict-JSON answer.
export function parseAnswerJson(text) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]);
    const answerIndices = Array.isArray(obj.answerIndices)
      ? obj.answerIndices.filter((v) => v !== null && v !== '').map(Number).filter(Number.isInteger) : [];
    const answerText = Array.isArray(obj.answerText)
      ? obj.answerText.map(String) : (obj.answerText != null ? [String(obj.answerText)] : []);
    return { answerIndices, answerText, reason: obj.reason ? String(obj.reason) : '' };
  } catch { return null; }
}

// Browser-only: perform the call. cfg = config.llm (includes provider).
export async function callLlm(cfg, { question, options, context }) {
  const messages = buildSolvePrompt({ question, options, context });
  const req = buildRequest(cfg.provider, cfg, messages);
  const res = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const answer = parseAnswerJson(parseResponse(cfg.provider, await res.json()));
  if (!answer) throw new Error('LLM returned unparseable answer');
  return answer;
}
