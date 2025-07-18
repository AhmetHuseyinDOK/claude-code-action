#!/usr/bin/env bun

/**
 * Setup the appropriate branch based on the event type:
 * - For PRs: Checkout the PR branch
 * - For Issues: Create a new branch
 */

import { $ } from "bun";
import * as core from "@actions/core";
import type { ParsedGitHubContext } from "../context";
import type { GitHubPullRequest } from "../types";
import type { Octokits } from "../api/client";
import type { FetchDataResult } from "../data/fetcher";
import { withTokenRefresh } from "./token-refresh";

export type BranchInfo = {
  baseBranch: string;
  claudeBranch?: string;
  currentBranch: string;
};

export async function setupBranch(
  octokits: Octokits,
  githubData: FetchDataResult,
  context: ParsedGitHubContext,
): Promise<BranchInfo> {
  // Track token refresh time
  const lastRefreshTime = { value: Date.now() };
  const { owner, repo } = context.repository;
  const entityNumber = context.entityNumber;
  const { baseBranch, branch, branchPrefix } = context.inputs;
  const isPR = context.isPR;

  // If a specific branch is provided, use it directly
  if (branch) {
    console.log(`Using provided branch: ${branch}`);

    // Check if the branch exists remotely
    try {
      await octokits.rest.repos.getBranch({
        owner,
        repo,
        branch,
      });
      console.log(`Branch ${branch} exists remotely`);
    } catch (error: any) {
      if (error.status === 404) {
        throw new Error(
          `Specified branch '${branch}' does not exist in the repository`,
        );
      }
      throw error;
    }

    // Fetch and checkout the specified branch with token refresh
    await withTokenRefresh(
      () => $`git fetch origin ${branch}`,
      context,
      null,
      lastRefreshTime,
    );
    await $`git checkout ${branch}`;

    console.log(`Successfully checked out existing branch: ${branch}`);

    // For existing branches, we need to determine the base branch
    // Try to get it from the branch's tracking information or use default
    let detectedBaseBranch: string;
    if (baseBranch) {
      detectedBaseBranch = baseBranch;
    } else {
      // Get the default branch as fallback
      const repoResponse = await octokits.rest.repos.get({
        owner,
        repo,
      });
      detectedBaseBranch = repoResponse.data.default_branch;
    }

    // Set outputs for GitHub Actions
    core.setOutput("CLAUDE_BRANCH", branch);
    core.setOutput("BASE_BRANCH", detectedBaseBranch);

    return {
      baseBranch: detectedBaseBranch,
      claudeBranch: branch,
      currentBranch: branch,
    };
  }

  if (isPR) {
    const prData = githubData.contextData as GitHubPullRequest;
    const prState = prData.state;

    // Check if PR is closed or merged
    if (prState === "CLOSED" || prState === "MERGED") {
      console.log(
        `PR #${entityNumber} is ${prState}, creating new branch from source...`,
      );
      // Fall through to create a new branch like we do for issues
    } else {
      // Handle open PR: Checkout the PR branch
      console.log("This is an open PR, checking out PR branch...");

      const branchName = prData.headRefName;

      // Determine optimal fetch depth based on PR commit count, with a minimum of 20
      const commitCount = prData.commits.totalCount;
      const fetchDepth = Math.max(commitCount, 20);

      console.log(
        `PR #${entityNumber}: ${commitCount} commits, using fetch depth ${fetchDepth}`,
      );

      // Execute git commands to checkout PR branch (dynamic depth based on PR size)
      await withTokenRefresh(
        () => $`git fetch origin --depth=${fetchDepth} ${branchName}`,
        context,
        null,
        lastRefreshTime,
      );
      await $`git checkout ${branchName}`;

      console.log(`Successfully checked out PR branch for PR #${entityNumber}`);

      // For open PRs, we need to get the base branch of the PR
      const baseBranch = prData.baseRefName;

      return {
        baseBranch,
        currentBranch: branchName,
      };
    }
  }

  // Determine source branch - use baseBranch if provided, otherwise fetch default
  let sourceBranch: string;

  if (baseBranch) {
    // Use provided base branch for source
    sourceBranch = baseBranch;
  } else {
    // No base branch provided, fetch the default branch to use as source
    const repoResponse = await octokits.rest.repos.get({
      owner,
      repo,
    });
    sourceBranch = repoResponse.data.default_branch;
  }

  // Generate branch name for either an issue or closed/merged PR
  const entityType = isPR ? "pr" : "issue";

  // Create Kubernetes-compatible timestamp: lowercase, hyphens only, shorter format
  const now = new Date();
  const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;

  // Ensure branch name is Kubernetes-compatible:
  // - Lowercase only
  // - Alphanumeric with hyphens
  // - No underscores
  // - Max 50 chars (to allow for prefixes)
  const branchName = `${branchPrefix}${entityType}-${entityNumber}-${timestamp}`;
  const newBranch = branchName.toLowerCase().substring(0, 50);

  try {
    // Get the SHA of the source branch to verify it exists
    const sourceBranchRef = await octokits.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${sourceBranch}`,
    });

    const currentSHA = sourceBranchRef.data.object.sha;
    console.log(`Source branch SHA: ${currentSHA}`);

    // For commit signing, defer branch creation to the file ops server
    if (context.inputs.useCommitSigning) {
      console.log(
        `Branch name generated: ${newBranch} (will be created by file ops server on first commit)`,
      );

      // Set outputs for GitHub Actions
      core.setOutput("CLAUDE_BRANCH", newBranch);
      core.setOutput("BASE_BRANCH", sourceBranch);
      return {
        baseBranch: sourceBranch,
        claudeBranch: newBranch,
        currentBranch: sourceBranch, // Stay on source branch for now
      };
    }

    // For non-signing case, create and checkout the branch locally only
    console.log(
      `Creating local branch ${newBranch} for ${entityType} #${entityNumber} from source branch: ${sourceBranch}...`,
    );

    // Create and checkout the new branch locally
    await $`git checkout -b ${newBranch}`;

    // Push the new branch to remote with token refresh
    await withTokenRefresh(
      () => $`git push -u origin ${newBranch}`,
      context,
      null,
      lastRefreshTime,
    );

    console.log(
      `Successfully created, checked out, and pushed local branch: ${newBranch}`,
    );

    // Set outputs for GitHub Actions
    core.setOutput("CLAUDE_BRANCH", newBranch);
    core.setOutput("BASE_BRANCH", sourceBranch);
    return {
      baseBranch: sourceBranch,
      claudeBranch: newBranch,
      currentBranch: newBranch,
    };
  } catch (error) {
    console.error("Error in branch setup:", error);
    process.exit(1);
  }
}
