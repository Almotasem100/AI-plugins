# opencode-anthropic-login-via-cli

Provenance record for the third-party Anthropic authentication plugin configured in the global OpenCode profile. This directory does not contain the plugin source.

- **Purpose:** Add Claude subscription OAuth login methods to OpenCode's Anthropic provider, including browser login without Claude Code CLI.
- **Package:** `opencode-anthropic-login-via-cli@1.7.1`
- **npm package:** [version 1.7.1](https://www.npmjs.com/package/opencode-anthropic-login-via-cli/v/1.7.1)
- **Upstream repository:** [cemalturkcan/opencode-anthropic-login-via-cli](https://github.com/cemalturkcan/opencode-anthropic-login-via-cli)
- **Published source commit:** [`69b7236f15fa3abaa200b1aad9875ba447083bef`](https://github.com/cemalturkcan/opencode-anthropic-login-via-cli/commit/69b7236f15fa3abaa200b1aad9875ba447083bef) (npm `gitHead`)
- **License declared by package:** MIT
- **npm tarball integrity:** `sha512-Fir000mnaMTrSng5bFUmwmYhLwkR3KmsEb8JfgJOkv/tY7dzbeErg1JQJ8LzVomoiS4wIjKSYMwvfId5dtF6iQ==`
- **npm tarball SHA-1:** `88004889065f8924f692cc3980ebdb5fd1fadbf3`
- **Install spec:** `opencode-anthropic-login-via-cli@1.7.1` in `~/.config/opencode/opencode.json`; this is a global profile installation, not a repository dependency.

## Risk and verification

This unofficial plugin uses subscription OAuth credentials and shapes requests to resemble Claude Code. Anthropic's [authentication policy](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use) restricts third-party use of subscription credentials and may be enforced without notice. Requests may be rejected or incur extra charges; a zero price shown in OpenCode is not proof of billing behavior.

On Windows with OpenCode 2.2.5, `opencode plugin list` showed version 1.7.1 and the Anthropic integration listed `Claude Pro/Max (browser)`. Authentication, model requests, billing and tool calls were not tested.
