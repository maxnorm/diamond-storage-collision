import { readFileSync } from "fs";

/**
 * Parse Foundry remappings.txt format.
 * Each line: prefix=path (e.g., "@perfect-abstractions/compose/=lib/Compose/src/")
 */
export function parseRemappings(remappingsPath: string): Map<string, string> {
  const content = readFileSync(remappingsPath, "utf-8");
  const remappings = new Map<string, string>();

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const prefix = trimmed.slice(0, eqIndex);
    const path = trimmed.slice(eqIndex + 1);
    remappings.set(prefix, path);
  }

  return remappings;
}
