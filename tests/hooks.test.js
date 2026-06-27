#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');

// isShellSafe gates the statusline setup snippet (issue #200): ordinary install
// paths pass, paths carrying shell metacharacters are rejected so they never get
// embedded in a shell command.
const { isShellSafe } = require('../hooks/ponytail-config');
assert.equal(isShellSafe('C:\\Users\\x\\.claude\\plugins\\ponytail\\hooks\\ponytail-statusline.ps1'), true);
assert.equal(isShellSafe('/home/u/.claude/plugins/ponytail/hooks/ponytail-statusline.sh'), true);
assert.equal(isShellSafe('/tmp/a"&calc.exe&"/x.sh'), false);
assert.equal(isShellSafe('/tmp/$(calc)/x.sh'), false);
assert.equal(isShellSafe('/tmp/a;rm -rf/x.sh'), false);

function run(script, env, input = '') {
  return spawnSync(process.execPath, [path.join(root, 'hooks', script)], {
    env: { ...process.env, ...env },
    input,
    encoding: 'utf8',
  });
}

// Keep the base env clean so the default-dir / native-Claude checks are
// deterministic; the CLAUDE_CONFIG_DIR and codex/copilot cases set these
// explicitly where needed. run() spreads process.env, so a PLUGIN_DATA /
// COPILOT_PLUGIN_DATA leaked from the dev or CI shell would otherwise steer
// writeHookOutput into the wrong branch and mis-fire the native assertions.
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.PLUGIN_DATA;
delete process.env.COPILOT_PLUGIN_DATA;

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-hooks-'));
// Runs on normal exit and on assertion-throw exit; force makes it idempotent.
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }));

const home = path.join(temp, 'home');
const pluginData = path.join(temp, 'plugin-data');
fs.mkdirSync(home, { recursive: true });

// USERPROFILE alongside HOME: os.homedir() reads USERPROFILE on Windows, HOME on POSIX.
const codexEnv = {
  HOME: home,
  USERPROFILE: home,
  PLUGIN_DATA: pluginData,
  PONYTAIL_DEFAULT_MODE: 'ultra',
};
const codexState = path.join(pluginData, '.ponytail', 'shared');

let result = run('ponytail-activate.js', codexEnv);
assert.equal(result.status, 0, result.stderr);
assert.equal(fs.readFileSync(codexState, 'utf8'), 'ultra');
let output = JSON.parse(result.stdout);
assert.equal(output.systemMessage, 'PONYTAIL:ULTRA');
assert.match(
  output.hookSpecificOutput.additionalContext,
  /PONYTAIL MODE ACTIVE — level: ultra/,
);

result = run(
  'ponytail-mode-tracker.js',
  codexEnv,
  JSON.stringify({ prompt: '@ponytail lite' }),
);
assert.equal(result.status, 0, result.stderr);
assert.equal(fs.readFileSync(codexState, 'utf8'), 'lite');
output = JSON.parse(result.stdout);
assert.equal(output.systemMessage, 'PONYTAIL:LITE');

result = run(
  'ponytail-mode-tracker.js',
  codexEnv,
  JSON.stringify({ prompt: 'normal mode' }),
);
assert.equal(result.status, 0, result.stderr);
assert.equal(fs.existsSync(codexState), false);
output = JSON.parse(result.stdout);
assert.equal(output.systemMessage, 'PONYTAIL:OFF');

// A request that merely mentions "normal mode" must not deactivate ponytail.
result = run('ponytail-mode-tracker.js', codexEnv, JSON.stringify({ prompt: '@ponytail lite' }));
assert.equal(result.status, 0, result.stderr);
assert.equal(fs.readFileSync(codexState, 'utf8'), 'lite');

result = run(
  'ponytail-mode-tracker.js',
  codexEnv,
  JSON.stringify({ prompt: 'add a normal mode toggle next to dark mode' }),
);
assert.equal(result.status, 0, result.stderr);
assert.equal(
  fs.readFileSync(codexState, 'utf8'),
  'lite',
  'incidental "normal mode" in a request must not turn ponytail off',
);

const claudeEnv = {
  HOME: home,
  USERPROFILE: home,
  PONYTAIL_DEFAULT_MODE: 'full',
};
delete claudeEnv.PLUGIN_DATA;

result = run('ponytail-activate.js', claudeEnv);
assert.equal(result.status, 0, result.stderr);
assert.equal(
  fs.readFileSync(path.join(home, '.claude', '.ponytail', 'shared'), 'utf8'),
  'full',
);

// CLAUDE_CONFIG_DIR overrides ~/.claude for the flag file (issue #34).
const home2 = path.join(temp, 'home2');
fs.mkdirSync(home2, { recursive: true });
const customConfigDir = path.join(temp, 'custom-claude');
result = run('ponytail-activate.js', {
  HOME: home2,
  USERPROFILE: home2,
  CLAUDE_CONFIG_DIR: customConfigDir,
  PONYTAIL_DEFAULT_MODE: 'lite',
});
assert.equal(result.status, 0, result.stderr);
assert.equal(
  fs.readFileSync(path.join(customConfigDir, '.ponytail', 'shared'), 'utf8'),
  'lite',
);
assert.equal(
  fs.existsSync(path.join(home2, '.claude', '.ponytail', 'shared')),
  false,
  'flag must not land in ~/.claude when CLAUDE_CONFIG_DIR is set',
);

const copilotData = path.join(temp, 'copilot-data');
const codexData = path.join(temp, 'codex-data-shadow');
result = run('ponytail-activate.js', {
  HOME: home,
  USERPROFILE: home,
  COPILOT_PLUGIN_DATA: copilotData,
  PLUGIN_DATA: codexData,
  PONYTAIL_DEFAULT_MODE: 'full',
});
assert.equal(result.status, 0, result.stderr);
assert.equal(fs.readFileSync(path.join(copilotData, '.ponytail', 'shared'), 'utf8'), 'full');
assert.equal(
  fs.existsSync(path.join(codexData, '.ponytail', 'shared')),
  false,
  'copilot hooks must not write mode state to codex PLUGIN_DATA',
);
output = JSON.parse(result.stdout);
assert.match(output.additionalContext, /PONYTAIL MODE ACTIVE — level: full/);

result = run(
  'ponytail-mode-tracker.js',
  {
    HOME: home,
    USERPROFILE: home,
    COPILOT_PLUGIN_DATA: copilotData,
    PLUGIN_DATA: codexData,
  },
  JSON.stringify({ prompt: '/ponytail ultra' }),
);
assert.equal(result.status, 0, result.stderr);
assert.equal(fs.readFileSync(path.join(copilotData, '.ponytail', 'shared'), 'utf8'), 'ultra');
assert.equal(
  fs.existsSync(path.join(codexData, '.ponytail', 'shared')),
  false,
  'copilot mode tracker must keep codex PLUGIN_DATA untouched',
);
output = JSON.parse(result.stdout);
assert.deepEqual(output, {});

// SubagentStart hook: when ponytail mode is active it injects the ruleset into
// each subagent (issue #252). Native Claude must get the hookSpecificOutput JSON
// form, not raw stdout, or the context is dropped.
const subHome = path.join(temp, 'sub-home');
const subFlag = path.join(subHome, '.claude', '.ponytail', 'shared');
fs.mkdirSync(path.dirname(subFlag), { recursive: true });
const subEnv = { HOME: subHome, USERPROFILE: subHome };

fs.writeFileSync(subFlag, 'full');
result = run('ponytail-subagent.js', subEnv);
assert.equal(result.status, 0, result.stderr);
output = JSON.parse(result.stdout);
assert.equal(output.hookSpecificOutput.hookEventName, 'SubagentStart');
assert.match(
  output.hookSpecificOutput.additionalContext,
  /PONYTAIL MODE ACTIVE — level: full/,
);

// No flag → ponytail off → inject nothing (empty stdout, no failure).
fs.unlinkSync(subFlag);
result = run('ponytail-subagent.js', subEnv);
assert.equal(result.status, 0, result.stderr);
assert.equal(result.stdout, '', 'SubagentStart must stay silent when ponytail is off');

// Codex shares claude-codex-hooks.json, so SubagentStart is reachable under Codex
// too — assert the codex branch emits the badge plus hookSpecificOutput.
const subCodex = path.join(temp, 'sub-codex');
fs.mkdirSync(subCodex, { recursive: true });
fs.mkdirSync(path.join(subCodex, '.ponytail'), { recursive: true });
fs.writeFileSync(path.join(subCodex, '.ponytail', 'shared'), 'full');
result = run('ponytail-subagent.js', { HOME: subHome, USERPROFILE: subHome, PLUGIN_DATA: subCodex });
assert.equal(result.status, 0, result.stderr);
output = JSON.parse(result.stdout);
assert.equal(output.systemMessage, 'PONYTAIL:FULL');
assert.equal(output.hookSpecificOutput.hookEventName, 'SubagentStart');
assert.match(output.hookSpecificOutput.additionalContext, /PONYTAIL MODE ACTIVE — level: full/);

// Per-session isolation: concurrent native-Claude sessions must not share one flag.
// session_id arrives on stdin; the flag becomes .ponytail/<session_id>, so a
// stop/mode-switch in one session can't leak into another's subagents or badge.
const isoHome = path.join(temp, 'iso-home');
const isoDir = path.join(isoHome, '.claude', '.ponytail');
fs.mkdirSync(isoDir, { recursive: true });
const isoEnv = { HOME: isoHome, USERPROFILE: isoHome };
const flagA = path.join(isoDir, 'AAA');
const flagB = path.join(isoDir, 'BBB');
const sharedFlag = path.join(isoDir, 'shared');

// activate keys the flag by session_id and leaves the shared flag untouched.
result = run('ponytail-activate.js', { ...isoEnv, PONYTAIL_DEFAULT_MODE: 'ultra' }, JSON.stringify({ session_id: 'AAA' }));
assert.equal(result.status, 0, result.stderr);
assert.equal(fs.readFileSync(flagA, 'utf8'), 'ultra');
assert.equal(fs.existsSync(sharedFlag), false, 'session_id present → must not write the shared flag');

result = run('ponytail-activate.js', { ...isoEnv, PONYTAIL_DEFAULT_MODE: 'full' }, JSON.stringify({ session_id: 'BBB' }));
assert.equal(result.status, 0, result.stderr);
assert.equal(fs.readFileSync(flagB, 'utf8'), 'full');

// Each subagent reads its own session's flag — no cross-session bleed.
result = run('ponytail-subagent.js', isoEnv, JSON.stringify({ session_id: 'AAA' }));
assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /level: ultra/);
result = run('ponytail-subagent.js', isoEnv, JSON.stringify({ session_id: 'BBB' }));
assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /level: full/);
result = run('ponytail-subagent.js', isoEnv, JSON.stringify({ session_id: 'CCC' }));
assert.equal(result.stdout, '', 'a session with no flag of its own must inherit nothing');

// A mode switch in one session must leave the other untouched.
result = run('ponytail-mode-tracker.js', isoEnv, JSON.stringify({ prompt: '/ponytail lite', session_id: 'AAA' }));
assert.equal(result.status, 0, result.stderr);
assert.equal(fs.readFileSync(flagA, 'utf8'), 'lite');
assert.equal(fs.readFileSync(flagB, 'utf8'), 'full', 'mode switch in AAA must not touch BBB');
assert.equal(fs.existsSync(sharedFlag), false);

// stop ponytail clears only the issuing session's flag (issue: shared-flag leak).
result = run('ponytail-mode-tracker.js', isoEnv, JSON.stringify({ prompt: 'stop ponytail', session_id: 'AAA' }));
assert.equal(result.status, 0, result.stderr);
assert.equal(fs.existsSync(flagA), false, 'stop must remove the issuing session flag');
assert.equal(fs.readFileSync(flagB, 'utf8'), 'full', 'stop in AAA must not disable BBB');

console.log('hook compatibility checks passed');
