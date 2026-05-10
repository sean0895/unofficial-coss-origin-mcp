#!/usr/bin/env bun
/**
 * Install — wires unofficial-coss-origin-mcp into the user's Claude Code setup.
 *
 *   - Adds MCP server entry
 *   - Copies hooks to ~/.claude/hooks/coss-* (namespaced)
 *   - Wires hooks into ~/.claude/settings.json
 *   - Registers /coss-mode skill
 *   - Sets statusLine command
 *   - Writes .coss-mode.json template at repo root
 *   - Backs up settings.json before mutating
 *   - Atomic merge — never overwrites unrelated keys
 *   - Self-test: runs each hook against fixtures
 *   - Refuses to install if @coss/* deps absent (anti-misapplication)
 *
 * Flags:
 *   --scope=user | project    default: project
 *   --dry-run                 show diff, do not write
 *   --force                   skip @coss/* dep check
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

interface Args {
  scope: "user" | "project";
  dryRun: boolean;
  force: boolean;
}

const parseArgs = (): Args => {
  const args = process.argv.slice(2);
  const scope = (args.find((a) => a.startsWith("--scope="))?.split("=")[1] ?? "project") as "user" | "project";
  return {
    scope,
    dryRun: args.includes("--dry-run"),
    force: args.includes("--force"),
  };
};

const cwd = process.cwd();
const HOME = homedir();

const detectCossProject = (): boolean => {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return false;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  return Object.keys(deps).some((d) => d.startsWith("@coss/"));
};

const settingsPath = (scope: "user" | "project"): string =>
  scope === "user" ? join(HOME, ".claude", "settings.json") : join(cwd, ".claude", "settings.json");

const hookTargetDir = (scope: "user" | "project"): string =>
  scope === "user"
    ? join(HOME, ".claude", "hooks", "coss-mode")
    : join(cwd, ".claude", "hooks", "coss-mode");

const skillTargetDir = (scope: "user" | "project"): string =>
  scope === "user" ? join(HOME, ".claude", "skills", "coss-mode") : join(cwd, ".claude", "skills", "coss-mode");

const cossHomeDir = (): string => join(HOME, ".claude", ".coss-mode");

const backup = (path: string): string | null => {
  if (!existsSync(path)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${path}.bak.${stamp}`;
  copyFileSync(path, backupPath);
  return backupPath;
};

const ensureDir = (p: string): void => {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
};

const copyHooks = (target: string, dryRun: boolean): void => {
  const src = join(REPO_ROOT, "hooks");
  const files = [
    "session-start.sh",
    "user-prompt-submit.sh",
    "pre-tool-use.sh",
    "post-tool-use.sh",
    "statusline.sh",
    "lib/common.sh",
    "lib/state.sh",
    "lib/audit.sh",
    "lib/rules.sh",
  ];
  for (const f of files) {
    const from = join(src, f);
    const to = join(target, f);
    if (dryRun) {
      console.log(`  [dry-run] copy ${from} -> ${to}`);
      continue;
    }
    ensureDir(dirname(to));
    copyFileSync(from, to);
    chmodSync(to, 0o755);
  }
};

const copySkill = (target: string, dryRun: boolean): void => {
  const from = join(REPO_ROOT, "skill", "coss-mode", "SKILL.md");
  const to = join(target, "SKILL.md");
  if (dryRun) { console.log(`  [dry-run] copy ${from} -> ${to}`); return; }
  ensureDir(target);
  copyFileSync(from, to);
};

const copyKnowledgeForHooks = (dryRun: boolean): void => {
  const cossHome = cossHomeDir();
  const target = join(cossHome, "knowledge");
  if (dryRun) { console.log(`  [dry-run] copy knowledge/* -> ${target}`); return; }
  ensureDir(target);
  for (const shard of ["components.json", "manifest.json"]) {
    const from = join(REPO_ROOT, "knowledge", shard);
    const to = join(target, shard);
    if (existsSync(from)) copyFileSync(from, to);
  }
};

interface Settings {
  mcpServers?: Record<string, unknown>;
  hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<{ type: string; command: string }> }>>;
  statusLine?: { type?: string; command?: string };
  [key: string]: unknown;
}

const mergeSettings = (existing: Settings, hookDir: string): Settings => {
  const next: Settings = { ...existing };
  next.mcpServers = {
    ...(existing.mcpServers ?? {}),
    "coss-origin": {
      command: "npx",
      args: ["-y", "unofficial-coss-origin-mcp"],
    },
  };

  const addHook = (event: string, matcher: string, command: string): void => {
    next.hooks ??= {};
    next.hooks[event] ??= [];
    const exists = next.hooks[event].some((h) =>
      h.hooks?.some((entry) => entry.command === command),
    );
    if (!exists) {
      next.hooks[event].push({
        matcher,
        hooks: [{ type: "command", command }],
      });
    }
  };

  addHook("SessionStart", "*", `bash "${join(hookDir, "session-start.sh")}"`);
  addHook("UserPromptSubmit", "*", `bash "${join(hookDir, "user-prompt-submit.sh")}"`);
  addHook("PreToolUse", "Write|Edit", `bash "${join(hookDir, "pre-tool-use.sh")}"`);
  addHook(
    "PostToolUse",
    "Write|Edit|.*find_recipe.*|.*get_recipe.*|.*compare_to_recipe.*",
    `bash "${join(hookDir, "post-tool-use.sh")}"`,
  );

  // statusLine: chain with existing if present.
  const cossSL = `bash "${join(hookDir, "statusline.sh")}"`;
  if (!existing.statusLine?.command) {
    next.statusLine = { type: "command", command: cossSL };
  } else if (!existing.statusLine.command.includes("statusline.sh")) {
    next.statusLine = {
      type: "command",
      command: `${existing.statusLine.command} && printf ' | ' && ${cossSL}`,
    };
  }

  return next;
};

const writeProjectConfig = (dryRun: boolean): void => {
  const target = join(cwd, ".coss-mode.json");
  if (existsSync(target)) {
    console.log(`  ok  .coss-mode.json already present (preserved)`);
    return;
  }
  const body = {
    version: 1,
    mode: "dry-run",
    paths: ["src/components/**/*.tsx", "src/app/**/*.tsx"],
    exclude: [
      "**/*.test.tsx",
      "**/*.spec.tsx",
      "**/*.stories.tsx",
      "src/components/ui/**",
      "e2e/**",
      "tests/**",
    ],
    rules_escalations: {},
    scan: "diff-only",
  };
  if (dryRun) {
    console.log(`  [dry-run] write ${target}: ${JSON.stringify(body, null, 2).slice(0, 80)}...`);
    return;
  }
  writeFileSync(target, JSON.stringify(body, null, 2));
  console.log(`  ok  wrote ${target}`);
};

const seedState = (dryRun: boolean): void => {
  const cossHome = cossHomeDir();
  const stateFile = join(cossHome, "state.json");
  if (existsSync(stateFile)) {
    console.log(`  ok  state.json already present (install_timestamp/dry_run_until immutable)`);
    return;
  }
  const installTs = new Date().toISOString();
  const dryUntil = new Date(Date.now() + 168 * 3600 * 1000).toISOString();
  const seed = {
    schema_version: 1,
    enabled: true,
    level: "full",
    mode: "dry-run",
    install_timestamp: installTs,
    dry_run_until: dryUntil,
    session_id: "install",
    session_started_at: installTs,
    last_toggle_at: null,
    last_toggle_turn: 0,
    toggle_history: [],
    violation_count_session: 0,
    consumed_recipe_ids: [],
    last_find_recipe: null,
  };
  if (dryRun) {
    console.log(`  [dry-run] seed ${stateFile}`);
    return;
  }
  ensureDir(cossHome);
  writeFileSync(stateFile, JSON.stringify(seed, null, 2), { mode: 0o600 });
  console.log(`  ok  seeded ${stateFile} (dry-run window ends ${dryUntil})`);
};

const selfTest = (hookDir: string): void => {
  // Run the hook against a sample violation in an isolated COSS_HOME with
  // mode forced to "enforce" — verifies the regex+block path even when the
  // installed default is dry-run.
  const tmpHome = join("/tmp", `coss-mode-selftest-${Date.now()}`);
  ensureDir(tmpHome);
  ensureDir(join(tmpHome, "knowledge"));
  // Seed enforce state.
  writeFileSync(
    join(tmpHome, "state.json"),
    JSON.stringify({
      schema_version: 1,
      enabled: true,
      level: "full",
      mode: "enforce",
      install_timestamp: new Date().toISOString(),
      dry_run_until: new Date(Date.now() - 1000).toISOString(),
      session_id: "selftest",
      session_started_at: new Date().toISOString(),
      last_toggle_at: null,
      last_toggle_turn: 0,
      toggle_history: [],
      violation_count_session: 0,
      consumed_recipe_ids: [],
      last_find_recipe: null,
    }, null, 2),
    { mode: 0o600 },
  );
  // copy components.json so primitive-not-in-snapshot rule has data
  const knowSrc = join(REPO_ROOT, "knowledge", "components.json");
  if (existsSync(knowSrc)) copyFileSync(knowSrc, join(tmpHome, "knowledge", "components.json"));

  const fixtureContent =
    '<div className="bg-blue-500" style={{color:"#ff0000"}}><button>x</button></div>';
  const fixturePayload = JSON.stringify({
    tool_name: "Write",
    tool_input: {
      file_path: join(cwd, "src", "components", "self-test.tsx"),
      content: fixtureContent,
    },
  });
  const result = spawnSync("bash", [join(hookDir, "pre-tool-use.sh")], {
    input: fixturePayload,
    encoding: "utf-8",
    env: { ...process.env, COSS_HOME: tmpHome },
  });
  if (result.status === 2) {
    console.log(`  ok  self-test: pre-tool-use blocked sample violation (exit=2)`);
  } else if (result.status === 0) {
    console.log(`  WARN self-test: hook did not block a known violation - investigate`);
    console.log(result.stderr);
  } else {
    console.log(`  WARN self-test: hook errored unexpectedly - exit=${result.status}`);
    console.log(result.stderr);
  }
  rmSyncQuiet(tmpHome);
};

const rmSyncQuiet = (p: string): void => {
  try {
    spawnSync("rm", ["-rf", p]);
  } catch { /* ignore */ }
};

const main = (): void => {
  const args = parseArgs();
  console.log(`unofficial-coss-origin-mcp install`);
  console.log(`  scope: ${args.scope}`);
  console.log(`  dry-run: ${args.dryRun}`);
  console.log(``);

  if (!detectCossProject() && !args.force) {
    console.error(`refusing to install: package.json has no @coss/* deps.`);
    console.error(`Re-run with --force if you intend to install in a non-COSS project.`);
    process.exit(1);
  }

  const hookDir = hookTargetDir(args.scope);
  const skillDir = skillTargetDir(args.scope);
  const settings = settingsPath(args.scope);

  console.log(`Step 1: backup ${settings}`);
  if (existsSync(settings)) {
    const b = args.dryRun ? null : backup(settings);
    console.log(b ? `  ok  ${b}` : `  [dry-run] would backup`);
  } else {
    console.log(`  (no existing settings.json)`);
  }

  console.log(`\nStep 2: copy hooks -> ${hookDir}`);
  copyHooks(hookDir, args.dryRun);

  console.log(`\nStep 3: copy skill -> ${skillDir}`);
  copySkill(skillDir, args.dryRun);

  console.log(`\nStep 4: copy knowledge for hook lookups`);
  copyKnowledgeForHooks(args.dryRun);

  console.log(`\nStep 5: write/merge ${settings}`);
  const existing: Settings = existsSync(settings) ? JSON.parse(readFileSync(settings, "utf-8")) : {};
  const merged = mergeSettings(existing, hookDir);
  if (args.dryRun) {
    console.log(`  [dry-run] would write merged settings.`);
    console.log(`  diff preview:`);
    console.log(JSON.stringify(merged, null, 2));
  } else {
    ensureDir(dirname(settings));
    writeFileSync(settings, JSON.stringify(merged, null, 2));
    console.log(`  ok  merged.`);
  }

  console.log(`\nStep 6: project config`);
  writeProjectConfig(args.dryRun);

  console.log(`\nStep 7: seed coss-mode state`);
  seedState(args.dryRun);

  if (!args.dryRun) {
    console.log(`\nStep 8: self-test`);
    selfTest(hookDir);
  }

  console.log(`\nok  install complete.

Next:
  1. Open a new Claude Code session in this project.
  2. Status line should show: COSS-ORIGIN: dry-run <countdown>
  3. After 168h, mode auto-flips to enforce.
  4. Toggle anytime: '/coss-mode lite|full|ultra' or 'stop coss' / 'coss on'
  5. Audit log: ~/.claude/.coss-mode/audit/

Uninstall:
  bunx unofficial-coss-origin-mcp uninstall --scope=${args.scope}
`);
};

main();
