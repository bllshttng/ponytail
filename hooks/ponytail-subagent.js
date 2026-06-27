#!/usr/bin/env node
// ponytail — Claude Code SubagentStart hook
//
// SessionStart context is parent-thread only and never reaches subagents, so
// without this every Task-spawned agent runs ponytail-unaware (issue #252).
// When ponytail mode is active, inject the same ruleset into each subagent.

const { getPonytailInstructions } = require('./ponytail-instructions');
const { readHookInput, readMode, writeHookOutput } = require('./ponytail-runtime');

// session_id is the PARENT session's id, so the subagent reads its own session's
// flag (issue #254 inheritance) without picking up another session's mode.
readHookInput((data) => {
  const mode = readMode(data.session_id);

  // Absent flag or off → ponytail isn't active; inject nothing.
  if (!mode || mode === 'off') {
    process.exit(0);
  }

  try {
    writeHookOutput('SubagentStart', mode, getPonytailInstructions(mode));
  } catch (e) {
    // Silent fail — a stdout error at hook exit must not surface as a hook failure.
  }
});
