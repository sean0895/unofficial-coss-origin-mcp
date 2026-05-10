#!/usr/bin/env bun
/**
 * Uninstall — reverses install. Restores most recent settings.json backup
 * if available, removes coss-mode hook entries, removes skill, removes hook dir.
 *
 * Does NOT delete state, audit logs, or .coss-mode.json by default
 * (audit trail preserved). Use --purge to wipe.
 */

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

interface Args {
  scope: "user" | "project";
  purge: boolean;
}

const parseArgs = (): Args => {
  const args = process.argv.slice(2);
  const scope = (args.find((a) => a.startsWith("--scope="))?.split("=")[1] ?? "project") as "user" | "project";
  return { scope, purge: args.includes("--purge") };
};

const HOME = homedir();
const cwd = process.cwd();

const settingsPath = (s: "user" | "project"): string =>
  s === "user" ? join(HOME, ".claude", "settings.json") : join(cwd, ".claude", "settings.json");

const hookDir = (s: "user" | "project"): string =>
  s === "user" ? join(HOME, ".claude", "hooks", "coss-mode") : join(cwd, ".claude", "hooks", "coss-mode");

const skillDir = (s: "user" | "project"): string =>
  s === "user" ? join(HOME, ".claude", "skills", "coss-mode") : join(cwd, ".claude", "skills", "coss-mode");

const stripHooks = (path: string): void => {
  if (!existsSync(path)) return;
  const settings = JSON.parse(readFileSync(path, "utf-8"));
  if (settings.mcpServers?.["coss-origin"]) delete settings.mcpServers["coss-origin"];
  if (settings.hooks) {
    for (const event of Object.keys(settings.hooks)) {
      settings.hooks[event] = (settings.hooks[event] as Array<{ hooks?: Array<{ command?: string }> }>)
        .map((h) => ({
          ...h,
          hooks: h.hooks?.filter((entry) => !entry.command?.includes("coss-mode")) ?? [],
        }))
        .filter((h) => (h.hooks?.length ?? 0) > 0);
      if (settings.hooks[event].length === 0) delete settings.hooks[event];
    }
  }
  if (settings.statusLine?.command?.includes("coss-mode")) {
    if (settings.statusLine.command.includes("statusline.sh") && settings.statusLine.command.includes("&&")) {
      settings.statusLine.command = settings.statusLine.command
        .split("&&")
        .filter((s: string) => !s.includes("coss-mode"))
        .map((s: string) => s.trim())
        .filter((s: string) => !s.startsWith("printf"))
        .join(" && ");
      if (!settings.statusLine.command) delete settings.statusLine;
    } else {
      delete settings.statusLine;
    }
  }
  writeFileSync(path, JSON.stringify(settings, null, 2));
};

const main = (): void => {
  const args = parseArgs();
  const settings = settingsPath(args.scope);

  console.log(`unofficial-coss-origin-mcp uninstall (scope=${args.scope}${args.purge ? ", purge" : ""})`);

  if (existsSync(settings)) {
    const dir = dirname(settings);
    const backups = existsSync(dir)
      ? readdirSync(dir).filter((f) => f.startsWith("settings.json.bak.")).sort().reverse()
      : [];
    if (backups.length > 0) {
      const newest = backups[0]!;
      console.log(`  most recent backup: ${join(dir, newest)}`);
      console.log(`  to restore: cp "${join(dir, newest)}" "${settings}"`);
    }
    stripHooks(settings);
    console.log(`  ok  stripped coss-mode entries from ${settings}`);
  }

  for (const path of [hookDir(args.scope), skillDir(args.scope)]) {
    if (existsSync(path)) {
      rmSync(path, { recursive: true, force: true });
      console.log(`  ok  removed ${path}`);
    }
  }

  if (args.purge) {
    const cossHome = join(HOME, ".claude", ".coss-mode");
    const projectConfig = join(cwd, ".coss-mode.json");
    if (existsSync(cossHome)) {
      rmSync(cossHome, { recursive: true, force: true });
      console.log(`  ok  purged ${cossHome}`);
    }
    if (existsSync(projectConfig)) {
      rmSync(projectConfig);
      console.log(`  ok  purged ${projectConfig}`);
    }
  } else {
    console.log(`  (state, audit logs, and .coss-mode.json preserved — use --purge to delete)`);
  }
  console.log(`done.`);
};

main();
