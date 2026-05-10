#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const path = join(process.cwd(), "dist", "server.js");
const body = await readFile(path, "utf-8");
const shebang = "#!/usr/bin/env node\n";
if (!body.startsWith(shebang)) {
  await writeFile(path, shebang + body.replace(/^#![^\n]*\n/, ""));
}
