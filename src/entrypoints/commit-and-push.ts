#!/usr/bin/env bun

/**
 * Commit and push changes with token refresh support
 * This replaces the shell script in action.yml with a proper TypeScript implementation
 */

import { $ } from "bun";
import * as core from "@actions/core";
import { parseGitHubContext } from "../github/context";
import { withTokenRefresh } from "../github/operations/token-refresh";

async function run() {
  try {
    const context = parseGitHubContext();
    const claudeBranch = process.env.CLAUDE_BRANCH;
    const githubRunId = process.env.GITHUB_RUN_ID;
    const triggeredBy =
      process.env.TRIGGER_USERNAME || process.env.GITHUB_ACTOR || "";

    // Track token refresh time
    const lastRefreshTime = { value: Date.now() };

    // Configure git user
    await $`git config --global user.name "claude-code-action[bot]"`;
    await $`git config --global user.email "claude-code-action[bot]@users.noreply.github.com"`;

    // Check if there are any changes to commit
    const gitStatus = await $`git status --porcelain`.quiet();
    const hasChanges = gitStatus.stdout.toString().trim().length > 0;

    if (!hasChanges) {
      console.log("No changes to commit");
      core.setOutput("committed", "false");
      return;
    }

    // Stage all changes
    await $`git add .`;

    // Commit with descriptive message
    const commitMessage = `Claude Code: Automated changes from workflow run ${githubRunId}

Changes made by Claude Code action in response to trigger.

Workflow: ${process.env.GITHUB_WORKFLOW}
Run ID: ${githubRunId}
Triggered by: ${triggeredBy}`;

    await $`git commit -m ${commitMessage}`;

    // Push changes with token refresh
    if (claudeBranch) {
      console.log(`Pushing to branch: ${claudeBranch}`);
      await withTokenRefresh(
        () => $`git push origin ${claudeBranch}`,
        context,
        null,
        lastRefreshTime,
      );
    } else {
      console.log("Pushing to current branch");
      await withTokenRefresh(
        () => $`git push origin HEAD`,
        context,
        null,
        lastRefreshTime,
      );
    }

    core.setOutput("committed", "true");
    console.log("Successfully committed and pushed changes");
  } catch (error) {
    console.error("Error in commit and push:", error);
    core.setFailed(`Failed to commit and push changes: ${error}`);
    process.exit(1);
  }
}

run();
