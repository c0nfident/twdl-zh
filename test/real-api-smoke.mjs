/* 真实 Kimi API 冒烟测试（可选工具，手动运行，不参与 CI）
 *
 * 用法（PowerShell）：
 *   $env:KIMI_BASE = 'https://api.moonshot.cn/v1'
 *   $env:KIMI_MODEL = 'kimi-k3'
 *   $env:KIMI_KEY  = '你的Key'        # 只在当前进程环境变量里，不要写进文件
 *   node test/real-api-smoke.mjs
 *
 * 校验点（与 twdl-0.2.1-zh.user.js 完全相同的请求体）：
 *  1) GET /users/me/balance   查余额
 *  2) GET /models             确认模型可用
 *  3) POST /chat/completions  文字翻译：kimi-k3 不传 temperature、reasoning_effort=low
 *  4) POST /chat/completions  视觉 OCR：content 对象数组、图片在前、base64 data URL
 */
import fs from 'node:fs';

const base = (process.env.KIMI_BASE || 'https://api.moonshot.cn/v1').replace(/\/+$/, '');
const model = process.env.KIMI_MODEL || 'kimi-k3';
const key = process.env.KIMI_KEY || '';

if (!key) {
  console.error('缺少 KIMI_KEY 环境变量');
  process.exit(2);
}

let failed = 0;
function check(name, okFlag, detail) {
  if (!okFlag) failed += 1;
  console.log((okFlag ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : ''));
}

async function call(pathname, init = {}) {
  const started = Date.now();
  const res = await fetch(base + pathname, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + key,
      ...(init.headers || {})
    },
    signal: AbortSignal.timeout(180000)
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, ms: Date.now() - started };
}

function chatContent(text) {
  const data = JSON.parse(text);
  const msg = data.choices && data.choices[0] && data.choices[0].message;
  return { content: (msg && msg.content) || '', usage: data.usage || null };
}

function payload(messages) {
  const body = { model, messages };
  if (/^kimi-k3/i.test(model)) body.reasoning_effort = 'low';
  else body.temperature = 0.2;
  return JSON.stringify(body);
}

const r1 = await call('/users/me/balance', { method: 'GET' });
check('GET /users/me/balance', r1.status === 200,
  'HTTP ' + r1.status + ' ' + r1.ms + 'ms ' + r1.text.slice(0, 140).replace(/\s+/g, ' '));

const r2 = await call('/models', { method: 'GET' });
let models = [];
try { models = (JSON.parse(r2.text).data || []).map((m) => m.id); } catch (e) { /* ignore */ }
check('GET /models 包含 ' + model, r2.status === 200 && models.indexOf(model) !== -1,
  'HTTP ' + r2.status + ' models=' + models.join(','));

const texts = ['Hello, this is a real API integration test.', 'Так получилось, что я пишу нишевые работы.'];
const r3 = await call('/chat/completions', {
  method: 'POST',
  body: payload([
    { role: 'system', content: '你是翻译引擎。把 JSON 字符串数组逐条翻译成简体中文，只输出 JSON 数组。' },
    { role: 'user', content: JSON.stringify(texts) }
  ])
});
let arr = null;
try {
  const c = chatContent(r3.text).content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  arr = JSON.parse(c);
} catch (e) { arr = null; }
check('文字翻译（kimi-k3 + reasoning_effort=low）',
  r3.status === 200 && Array.isArray(arr) && arr.length === texts.length && /[\u4e00-\u9fff]/.test(arr.join('')),
  'HTTP ' + r3.status + ' ' + r3.ms + 'ms ' + JSON.stringify(arr));

try {
  const img = fs.readFileSync(new URL('./zh-result.png', import.meta.url));
  const dataUrl = 'data:image/png;base64,' + img.toString('base64');
  const r4 = await call('/chat/completions', {
    method: 'POST',
    body: payload([
      { role: 'system', content: '你是 OCR + 翻译引擎，识别图片文字并翻译成简体中文；没有文字输出 NO_TEXT。' },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: '请识别图片中的文字并翻译成简体中文。' }
        ]
      }
    ])
  });
  const c = r4.status === 200 ? chatContent(r4.text) : { content: '' };
  check('视觉 OCR（image_url 在前 + base64）', r4.status === 200 && c.content.length > 0,
    'HTTP ' + r4.status + ' ' + r4.ms + 'ms ' + c.content.slice(0, 100).replace(/\s+/g, ' '));
} catch (e) {
  check('视觉 OCR', false, String(e && e.message));
}

console.log('\n结论: ' + (failed === 0 ? '全部通过' : '有 ' + failed + ' 项失败'));
process.exit(failed === 0 ? 0 : 1);
