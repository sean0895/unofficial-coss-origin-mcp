#!/usr/bin/env bun
/**
 * Crawler — fetch raw artifacts from coss.com into .cache/raw/.
 *
 * Sources:
 *   - https://coss.com/ui/r/registry.json     (index of 551 items)
 *   - https://coss.com/ui/r/{name}.json       (full source per item)
 *   - https://coss.com/ui/llms.txt            (doc URL list)
 *   - https://coss.com/ui/docs/{slug}.md      (markdown docs)
 *
 * Respects rate limits (8 concurrent). Caches by ETag-style filename.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ORIGIN = "https://coss.com";
const REGISTRY_URL = `${ORIGIN}/ui/r/registry.json`;
const LLMS_URL = `${ORIGIN}/ui/llms.txt`;
const CACHE_ROOT = join(process.cwd(), ".cache", "raw");
const CONCURRENCY = 8;

interface RegistryItem {
  name: string;
  type: string;
  description?: string;
  categories?: string[];
  registryDependencies?: string[];
  files?: Array<{ path: string; type: string }>;
}

interface RegistryIndex {
  homepage?: string;
  items: RegistryItem[];
}

const ensureDir = async (p: string): Promise<void> => {
  await mkdir(p, { recursive: true });
};

const fetchText = async (url: string): Promise<string> => {
  const res = await fetch(url, {
    headers: { "user-agent": "unofficial-coss-origin-mcp-crawler/0.1" },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
};

const writeJson = async (path: string, data: unknown): Promise<void> => {
  await writeFile(path, JSON.stringify(data, null, 2));
};

const pool = async <T, R>(
  items: T[],
  worker: (t: T) => Promise<R>,
  size: number,
): Promise<R[]> => {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const next = async (): Promise<void> => {
    while (cursor < items.length) {
      const i = cursor++;
      const item = items[i];
      if (item === undefined) return;
      try {
        out[i] = await worker(item);
      } catch (err) {
        console.warn(`[crawl] failed`, item, String(err));
        out[i] = null as R;
      }
    }
  };
  await Promise.all(Array.from({ length: size }, () => next()));
  return out;
};

const main = async (): Promise<void> => {
  await ensureDir(CACHE_ROOT);
  await ensureDir(join(CACHE_ROOT, "items"));
  await ensureDir(join(CACHE_ROOT, "docs"));

  console.log(`[crawl] registry index ← ${REGISTRY_URL}`);
  const registryRaw = await fetchText(REGISTRY_URL);
  await writeFile(join(CACHE_ROOT, "registry.json"), registryRaw);
  const registry: RegistryIndex = JSON.parse(registryRaw);
  console.log(`[crawl] registry: ${registry.items.length} items`);

  console.log(`[crawl] per-item details (${registry.items.length} fetches, concurrency=${CONCURRENCY})`);
  let done = 0;
  await pool(
    registry.items,
    async (item: RegistryItem) => {
      const url = `${ORIGIN}/ui/r/${item.name}.json`;
      const text = await fetchText(url);
      await writeFile(join(CACHE_ROOT, "items", `${item.name}.json`), text);
      done++;
      if (done % 50 === 0) console.log(`[crawl]   ${done}/${registry.items.length}`);
      return null;
    },
    CONCURRENCY,
  );
  console.log(`[crawl]   ${done}/${registry.items.length} done`);

  console.log(`[crawl] llms.txt`);
  const llms = await fetchText(LLMS_URL);
  await writeFile(join(CACHE_ROOT, "llms.txt"), llms);

  const docUrls = Array.from(
    new Set(
      Array.from(llms.matchAll(/https:\/\/coss\.com\/ui\/docs\/[^\s)]+\.md/g)).map(
        (m) => m[0],
      ),
    ),
  );
  console.log(`[crawl] docs (${docUrls.length} files)`);
  await pool(
    docUrls,
    async (url) => {
      const slug = url.replace(`${ORIGIN}/ui/docs/`, "").replace(/\.md$/, "");
      const safe = slug.replace(/\//g, "__");
      const text = await fetchText(url);
      await writeFile(join(CACHE_ROOT, "docs", `${safe}.md`), text);
      await writeJson(join(CACHE_ROOT, "docs", `${safe}.meta.json`), { url, slug });
      return null;
    },
    CONCURRENCY,
  );
  console.log(`[crawl] docs done`);

  console.log(`[crawl] complete → .cache/raw/`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
