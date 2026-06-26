const GIT_AUTH_ERROR_PATTERN =
  /authentication failed|could not read (?:username|password)|terminal prompts disabled|invalid username or password|username for ['"]|http basic: access denied|permission denied \(publickey\)|change-3222|app passwords are deprecated|returned error: 410/i;

export function isGitAuthDeploymentError(message: string | null | undefined): boolean {
  if (!message) return false;
  return GIT_AUTH_ERROR_PATTERN.test(message);
}

export function deploymentErrorSummary(message: string | null | undefined): string {
  if (message && /change-3222|app passwords are deprecated|error: 410/i.test(message)) {
    return "Bitbucket app passwords no longer work for git pull. In Settings → Bitbucket, use your Atlassian account email and a Bitbucket API token (not an app password), then retry deployment.";
  }
  if (message && isGitAuthDeploymentError(message)) {
    return "Git could not authenticate with Bitbucket during deployment. Connect your Atlassian account email and Bitbucket API token in Settings, then retry.";
  }
  if (message?.includes("require Bitbucket authentication")) {
    return message;
  }
  return "The pull request was merged, but deployment commands did not complete. Retry deployment to continue verification.";
}

export function deploymentErrorTitle(message: string | null | undefined): string {
  if (message && isGitAuthDeploymentError(message)) {
    return "Git Authentication Failed";
  }
  if (message?.includes("require Bitbucket authentication")) {
    return "Bitbucket Credentials Required";
  }
  return "Deployment Failed";
}
