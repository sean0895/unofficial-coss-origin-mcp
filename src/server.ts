#!/usr/bin/env node
/**
 * unofficial-coss-origin-mcp — MCP stdio server.
 *
 * Boot:  load knowledge/* snapshot → register tools → serve over stdio.
 *
 * Agent contract: tools never return raw JSX. Recipes come back as structured
 * ComposedPlans (ingredients + rules + source_ref + snapshot_version).
 * This forces the agent to compose locally instead of paste, which keeps the
 * generated UI on COSS rails and grounded in the verified snapshot.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { loadSnapshot } from "./snapshot.js";
import { allTools } from "./tools.js";

const zodToJsonSchema = (schema: z.ZodType<unknown>): Record<string, unknown> => {
  // Minimal Zod-object → JSON-Schema translator (sufficient for our flat schemas).
  if (schema instanceof z.ZodObject) {
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      const def = (value as z.ZodTypeAny)._def;
      const inner = def.typeName === "ZodDefault" || def.typeName === "ZodOptional" ? def.innerType : value as z.ZodTypeAny;
      const description = (value as z.ZodTypeAny).description;
      properties[key] = { ...zodInnerToJsonSchema(inner), ...(description ? { description } : {}) };
      if (def.typeName !== "ZodOptional" && def.typeName !== "ZodDefault") required.push(key);
    }
    return {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    };
  }
  return zodInnerToJsonSchema(schema);
};

const zodInnerToJsonSchema = (schema: z.ZodTypeAny): Record<string, unknown> => {
  const def = schema._def;
  switch (def.typeName) {
    case "ZodString":
      return { type: "string" };
    case "ZodNumber":
      return { type: "number" };
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodArray":
      return { type: "array", items: zodInnerToJsonSchema(def.type) };
    case "ZodOptional":
    case "ZodDefault":
      return zodInnerToJsonSchema(def.innerType);
    case "ZodObject":
      return zodToJsonSchema(schema);
    default:
      return { type: "string" };
  }
};

const main = async (): Promise<void> => {
  const snapshot = await loadSnapshot();
  const tools = allTools();

  const server = new Server(
    {
      name: "unofficial-coss-origin-mcp",
      version: "0.1.0",
    },
    {
      capabilities: { tools: {} },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: rawArgs } = req.params;
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
      };
    }
    const parsed = tool.inputSchema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      return {
        isError: true,
        content: [{ type: "text", text: `Invalid arguments for ${name}: ${parsed.error.message}` }],
      };
    }
    try {
      const result = await tool.handler(parsed.data, snapshot);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: `Tool ${name} failed: ${String(err)}` }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[unofficial-coss-origin-mcp] ready — snapshot ${snapshot.manifest.snapshot_version} (hash=${snapshot.manifest.hash}) — ${tools.length} tools\n`,
  );
};

main().catch((err) => {
  process.stderr.write(`[unofficial-coss-origin-mcp] fatal: ${String(err)}\n`);
  process.exit(1);
});
