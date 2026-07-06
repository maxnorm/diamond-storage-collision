import { readFileSync } from "fs";
import { resolve, dirname } from "path";

export type FacetConfig = {
  source: "local" | "package" | "registry";
  contract: string;
  package?: string;
};

export type DiamondConfig = {
  contract: string;
  facets: Record<string, FacetConfig>;
};

export type ChainConfig = {
  rpc: string;
  chainId: number;
};

export type ComposeConfig = {
  project: string;
  compose: string;
  framework: "foundry" | "hardhat";
  diamonds: Record<string, DiamondConfig>;
  chains: Record<string, ChainConfig>;
};

export function loadCompose(configPath: string): {
  config: ComposeConfig;
  rootDir: string;
} {
  const content = readFileSync(configPath, "utf-8");
  const config = JSON.parse(content) as ComposeConfig;
  const rootDir = dirname(resolve(configPath));

  if (!config.diamonds || Object.keys(config.diamonds).length === 0) {
    throw new Error("compose.json has no diamonds defined");
  }

  for (const [name, diamond] of Object.entries(config.diamonds)) {
    if (!diamond.facets || Object.keys(diamond.facets).length === 0) {
      throw new Error(`Diamond "${name}" has no facets defined`);
    }
    for (const [facetName, facet] of Object.entries(diamond.facets)) {
      if (!facet.source || !facet.contract) {
        throw new Error(
          `Facet "${facetName}" in diamond "${name}" is missing "source" or "contract"`
        );
      }
    }
  }

  return { config, rootDir };
}
