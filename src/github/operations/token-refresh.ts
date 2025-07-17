#!/usr/bin/env bun

/**
 * Utility functions for refreshing GitHub tokens during long-running operations
 */

import { refreshGitHubToken } from "../token";
import { reconfigureGitToken } from "./git-config";
import type { ParsedGitHubContext } from "../context";

type GitUser = {
  login: string;
  id: number;
};

/**
 * Refresh GitHub token and reconfigure git authentication
 * This should be called before any git operations that might fail due to token expiration
 */
export async function refreshTokenAndReconfigureGit(
  context: ParsedGitHubContext,
  user: GitUser | null,
): Promise<string> {
  console.log("Refreshing GitHub token for continued git operations...");

  try {
    // Get a fresh token
    const freshToken = await refreshGitHubToken();

    // Reconfigure git authentication with the fresh token
    await reconfigureGitToken(freshToken, context);

    console.log("✓ GitHub token refreshed and git authentication reconfigured");
    return freshToken;
  } catch (error) {
    console.error("Failed to refresh token and reconfigure git:", error);
    throw new Error(`Token refresh failed: ${error}`);
  }
}

/**
 * Check if we should refresh the token based on elapsed time
 * GitHub App tokens typically expire after 1 hour, so refresh after 45 minutes
 */
export function shouldRefreshToken(lastRefreshTime: number): boolean {
  const REFRESH_THRESHOLD_MS = 45 * 60 * 1000; // 45 minutes
  const elapsed = Date.now() - lastRefreshTime;
  return elapsed >= REFRESH_THRESHOLD_MS;
}

/**
 * Wrapper for git operations that automatically refreshes token if needed
 */
export async function withTokenRefresh<T>(
  operation: () => Promise<T>,
  context: ParsedGitHubContext,
  user: GitUser | null,
  lastRefreshTime: { value: number },
): Promise<T> {
  // Check if we should refresh the token before the operation
  if (shouldRefreshToken(lastRefreshTime.value)) {
    await refreshTokenAndReconfigureGit(context, user);
    lastRefreshTime.value = Date.now();
  }

  try {
    return await operation();
  } catch (error) {
    // If the operation fails, try refreshing the token and retry once
    const errorMessage = String(error);
    if (
      errorMessage.includes("authentication") ||
      errorMessage.includes("401") ||
      errorMessage.includes("403") ||
      errorMessage.includes("token")
    ) {
      console.log(
        "Git operation failed, attempting token refresh and retry...",
      );

      try {
        await refreshTokenAndReconfigureGit(context, user);
        lastRefreshTime.value = Date.now();
        return await operation();
      } catch (retryError) {
        console.error("Retry after token refresh also failed:", retryError);
        throw retryError;
      }
    }

    // If it's not a token-related error, just re-throw
    throw error;
  }
}
