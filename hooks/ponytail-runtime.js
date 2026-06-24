const fs = require('fs');
const path = require('path');
const { getClaudeDir } = require('./ponytail-config');

const STATE_FILE = '.ponytail-active';
const isCopilot = Boolean(process.env.COPILOT_PLUGIN_DATA);
const isCodex = !isCopilot && Boolean(process.env.PLUGIN_DATA);

let stateDir = getClaudeDir();
if (isCodex) stateDir = process.env.PLUGIN_DATA;
if (isCopilot) stateDir = process.env.COPILOT_PLUGIN_DATA;

const sharedPath = path.join(stateDir, STATE_FILE);

// Per-session flag keeps concurrent Claude sessions from aliasing onto one global
// flag — a stop/mode-switch in one session used to leak into another's subagents
// and badge. Claude passes session_id to every hook; when it's absent (Codex,
// Copilot, tests) we fall back to the shared flag, preserving prior behavior.
// session_id is UUID-ish; allow only filename-safe chars so it can't escape stateDir.
function statePathFor(sessionId) {
  const ok = typeof sessionId === 'string' && /^[A-Za-z0-9_-]+$/.test(sessionId);
  return ok ? path.join(stateDir, STATE_FILE + '-' + sessionId) : sharedPath;
}

function setMode(mode, sessionId) {
  const statePath = statePathFor(sessionId);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, mode);
}

function clearMode(sessionId) {
  try { fs.unlinkSync(statePathFor(sessionId)); } catch (e) {}
}

// Live mode written by activate/mode-tracker. Absent flag = ponytail off.
function readMode(sessionId) {
  try {
    return fs.readFileSync(statePathFor(sessionId), 'utf8').trim() || null;
  } catch (e) {
    return null;
  }
}

// Read + parse a hook's stdin JSON once, then invoke cb(data). Tolerates empty or
// malformed input (cb({})) so a hook never hangs or throws on odd stdin.
function readHookInput(cb) {
  let input = '';
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    let data = {};
    try { data = JSON.parse(input.replace(/^﻿/, '')) || {}; } catch (e) {}
    cb(data);
  });
}

function writeHookOutput(event, mode, context = '') {
  if (isCopilot) {
    // Copilot reads additionalContext on SessionStart; ignores output elsewhere.
    process.stdout.write(JSON.stringify(
      event === 'SessionStart' && context ? { additionalContext: context } : {}));
    return;
  }
  if (isCodex) {
    const output = { systemMessage: `PONYTAIL:${mode.toUpperCase()}` };
    if (context) {
      output.hookSpecificOutput = {
        hookEventName: event,
        additionalContext: context,
      };
    }
    process.stdout.write(JSON.stringify(output));
    return;
  }
  // Native Claude: SessionStart accepts raw stdout, but SubagentStart needs the
  // hookSpecificOutput JSON form or the context is dropped.
  if (event === 'SubagentStart') {
    process.stdout.write(JSON.stringify(
      { hookSpecificOutput: { hookEventName: event, additionalContext: context } }));
    return;
  }
  process.stdout.write(context);
}

module.exports = {
  clearMode,
  isCodex,
  isCopilot,
  readHookInput,
  readMode,
  setMode,
  writeHookOutput,
};
