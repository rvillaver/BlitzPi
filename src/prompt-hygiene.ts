/**
 * Pi's system prompt lists its own docs/examples under BlitzPi's install directory ("Pi documentation …
 * /…/node_modules/@earendil-works/pi-coding-agent/…"). For a BlitzPi user that directory is infrastructure,
 * not the project, and pointing the agent at it is an invitation to read outside the workspace. Strip that
 * block; everything else Pi wrote stays.
 */
export function stripInstallDocs(systemPrompt: string): string {
  return systemPrompt.replace(/\n\nPi documentation \(read only[^\n]*\n(?:- [^\n]*\n?)+/g, "\n");
}
