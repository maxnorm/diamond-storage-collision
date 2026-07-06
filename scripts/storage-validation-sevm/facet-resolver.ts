import { readdirSync, readFileSync, statSync } from "fs";
import { join, extname, resolve } from "path";
import type { ComposeConfig, FacetConfig } from "./compose-loader.js";
import { parseRemappings } from "./parse-remappings.js";

export type ResolvedFacet = {
  facetName: string;
  contractName: string;
  filePath: string | null;
  source: "local" | "package" | "registry";
};

/**
 * Strip :ContractName suffix from contract field.
 * "src/facets/CounterFacet.sol:CounterFacet" → { filePath: "src/facets/CounterFacet.sol", contractName: "CounterFacet" }
 */
function parseContractField(contract: string): {
  filePath: string;
  contractName: string;
} {
  const colonIndex = contract.lastIndexOf(":");
  if (colonIndex === -1) {
    return { filePath: contract, contractName: contract };
  }
  return {
    filePath: contract.slice(0, colonIndex),
    contractName: contract.slice(colonIndex + 1),
  };
}

/**
 * Search a directory recursively for a .sol file containing "contract <name>".
 */
function findContractInDir(dir: string, contractName: string): string | null {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      const found = findContractInDir(fullPath, contractName);
      if (found) return found;
    } else if (extname(entry) === ".sol") {
      try {
        const content = readFileSync(fullPath, "utf-8");
        if (
          content.includes(`contract ${contractName}`) ||
          content.includes(`interface ${contractName}`)
        ) {
          return fullPath;
        }
      } catch {
        continue;
      }
    }
  }

  return null;
}

/**
 * Resolve package facet path using remappings.
 */
function resolvePackageFacet(
  packageName: string | undefined,
  contractName: string,
  rootDir: string
): string | null {
  if (!packageName) return null;

  // Try to find remappings.txt in the project
  const remappingsPath = join(rootDir, "remappings.txt");
  let libBase: string | null = null;

  try {
    const remappings = parseRemappings(remappingsPath);
    for (const [prefix, path] of remappings) {
      if (packageName.startsWith(prefix.replace(/\/$/, ""))) {
        libBase = resolve(rootDir, path);
        break;
      }
    }
  } catch {
    // No remappings.txt found, try common locations
  }

  // Fallback: try common forge lib paths
  if (!libBase) {
    const candidates = [
      join(rootDir, "lib", packageName.split("/").pop() || packageName, "src"),
      join(rootDir, "node_modules", packageName),
    ];
    for (const candidate of candidates) {
      try {
        statSync(candidate);
        libBase = candidate;
        break;
      } catch {
        continue;
      }
    }
  }

  if (!libBase) return null;

  return findContractInDir(libBase, contractName);
}

export function resolveFacets(
  config: ComposeConfig,
  rootDir: string,
  diamondName: string
): ResolvedFacet[] {
  const diamond = config.diamonds[diamondName];
  const resolved: ResolvedFacet[] = [];

  for (const [facetName, facet] of Object.entries(diamond.facets)) {
    const { filePath, contractName } = parseContractField(facet.contract);

    let resolvedPath: string | null = null;

    switch (facet.source) {
      case "local":
        resolvedPath = resolve(rootDir, filePath);
        break;
      case "package":
        resolvedPath = resolvePackageFacet(facet.package, contractName, rootDir);
        if (!resolvedPath) {
          console.warn(
            `  Warning: Could not resolve package facet "${facetName}" (${facet.package}) — skipping`
          );
        }
        break;
      case "registry":
        resolvedPath = null;
        break;
    }

    resolved.push({
      facetName,
      contractName,
      filePath: resolvedPath,
      source: facet.source,
    });
  }

  return resolved;
}
