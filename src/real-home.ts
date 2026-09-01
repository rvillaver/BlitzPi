/**
 * The user's real home directory — even from inside a confined bash command, whose `HOME` every sandbox backend
 * pins to the project workspace so `~` in a shell command resolves inside the sandbox (see bash-guard.ts). That
 * pin is correct for the shell, but BlitzPi's OWN global state (~/.blitz/…, ~/.pi/…) must still resolve against
 * the real home even when a `blitzpi <subcommand>` (bridge status, feeds status, report, level, …) runs as one
 * of the agent's own bash tool calls — otherwise it silently reads/writes under <project>/.blitz/… instead and
 * looks unconfigured even when it isn't. Every sandbox backend exports `BLITZ_REAL_HOME` alongside the pinned
 * `HOME`; this is the one place that reads it back.
 */
import os from "node:os";

export function realHome(): string {
  return process.env.BLITZ_REAL_HOME || process.env.HOME || os.homedir();
}
