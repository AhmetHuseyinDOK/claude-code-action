#!/usr/bin/env node
// Structured Outputs MCP Server - Allows Claude to set GitHub Action outputs dynamically
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "node:fs/promises";

const server = new McpServer({
  name: "Structured Outputs Server",
  version: "0.0.1",
});

server.tool(
  "set_action_output",
  "Set a GitHub Action output that can be used by subsequent workflow steps",
  {
    key: z
      .string()
      .describe(
        "The output key name (e.g., 'file_path', 'pr_url', 'status') - 'claude_' prefix will be added automatically",
      ),
    value: z.string().describe("The output value (supports multiline text)"),
  },
  async ({ key, value }) => {
    try {
      const githubOutput = process.env.GITHUB_OUTPUT;

      if (!githubOutput) {
        throw new Error("GITHUB_OUTPUT environment variable not set");
      }

      // Add claude_ prefix to avoid conflicts
      const prefixedKey = `claude_${key}`;

      // Handle multiline values using heredoc syntax
      const hasNewlines = value.includes("\n");

      if (hasNewlines) {
        // Use heredoc format for multiline values
        const outputContent = `${prefixedKey}<<EOF\n${value}\nEOF\n`;
        await fs.appendFile(githubOutput, outputContent);
      } else {
        // Simple key=value format for single line
        const outputContent = `${prefixedKey}=${value}\n`;
        await fs.appendFile(githubOutput, outputContent);
      }

      console.log(
        `Set GitHub Action output: ${prefixedKey}=${hasNewlines ? "[multiline]" : value}`,
      );

      return {
        content: [
          {
            type: "text",
            text: `Set output '${prefixedKey}' = ${hasNewlines ? "[multiline content]" : value}`,
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Error setting action output:", errorMessage);
      return {
        content: [
          {
            type: "text",
            text: `Error setting action output: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "set_multiple_action_outputs",
  "Set multiple GitHub Action outputs at once",
  {
    outputs: z
      .record(z.string())
      .describe(
        "Key-value pairs of outputs to set - 'claude_' prefix will be added automatically to all keys",
      ),
  },
  async ({ outputs }) => {
    try {
      const githubOutput = process.env.GITHUB_OUTPUT;

      if (!githubOutput) {
        throw new Error("GITHUB_OUTPUT environment variable not set");
      }

      let outputContent = "";
      const keys = Object.keys(outputs);
      const prefixedKeys: string[] = [];

      for (const key of keys) {
        const value = outputs[key];
        if (value === undefined) {
          continue; // Skip undefined values
        }
        const prefixedKey = `claude_${key}`;
        prefixedKeys.push(prefixedKey);
        const hasNewlines = value.includes("\n");

        if (hasNewlines) {
          outputContent += `${prefixedKey}<<EOF\n${value}\nEOF\n`;
        } else {
          outputContent += `${prefixedKey}=${value}\n`;
        }
      }

      await fs.appendFile(githubOutput, outputContent);

      console.log(
        `Set ${keys.length} GitHub Action outputs:`,
        prefixedKeys.join(", "),
      );

      return {
        content: [
          {
            type: "text",
            text: `Set ${keys.length} outputs: ${prefixedKeys.join(", ")}`,
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Error setting multiple action outputs:", errorMessage);
      return {
        content: [
          {
            type: "text",
            text: `Error setting multiple action outputs: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Structured Outputs MCP Server running on stdio");
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
}
