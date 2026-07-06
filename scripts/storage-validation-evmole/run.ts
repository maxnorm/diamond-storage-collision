import { parseSourceFiles } from "./source-parser.js";
import { parseBytecode } from "./evmole-parser.js";
import { compareLayouts, comparePlannedVsDeployed } from "./layout-comparator.js";
import { loadCompose } from "./compose-loader.js";
import { resolveFacets } from "./facet-resolver.js";
import type { StorageLayout, DeploymentValidation } from "./types.js";

// --- Helpers ---

function printSeparator() {
  console.log("─".repeat(60));
}

function printLayouts(layouts: StorageLayout[]) {
  if (layouts.length === 0) {
    console.log("  No storage layouts detected.\n");
    return;
  }

  for (const layout of layouts) {
    const originTag = layout.origin === "on-chain" ? "[on-chain]" : "[local]";
    console.log(
      `  ${originTag} ${layout.contractName} → namespace "${layout.namespace}"`
    );
    console.log(`    struct: ${layout.structName}`);
    console.log(`    base slot: 0x${layout.baseSlot}`);
    for (const field of layout.fields) {
      console.log(
        `      offset ${field.slotOffset}: ${field.type} ${field.name}`
      );
    }
  }
  console.log();
}

function printResults(results: ReturnType<typeof compareLayouts>) {
  for (const result of results) {
    const icon =
      result.severity === "safe"
        ? "\x1b[32m✓\x1b[0m"
        : result.severity === "warning"
          ? "\x1b[33m⚠\x1b[0m"
          : "\x1b[31m✗\x1b[0m";

    console.log(`${icon} Namespace: ${result.namespace}`);
    console.log(`  ${result.message}`);

    for (const layout of result.layouts) {
      const originTag =
        layout.origin === "on-chain" ? "on-chain" : "local";
      const fieldsStr =
        layout.fields.length > 0
          ? `{ ${layout.fields.map((f) => f.name).join(", ")} }`
          : "{ }";
      console.log(
        `    [${originTag}] ${layout.contract}: ${fieldsStr}`
      );
    }
    console.log();
  }
}

function printDeploymentValidation(validation: DeploymentValidation) {
  for (const ns of validation.namespaces) {
    const icon =
      ns.status === "safe"
        ? "\x1b[32m✓\x1b[0m"
        : ns.status === "warning"
          ? "\x1b[33m⚠\x1b[0m"
          : "\x1b[31m✗\x1b[0m";

    console.log(`${icon} Namespace: "${ns.namespace}"`);
    console.log(`  base slot: 0x${ns.planned[0]?.baseSlot || ns.deployed[0]?.baseSlot}`);
    console.log();

    if (ns.planned.length > 0) {
      console.log(`  Planned (${ns.planned.length}):`);
      for (const p of ns.planned) {
        console.log(`    ${p.contractName}`);
        console.log(`      struct: ${p.structName}`);
        console.log(`      source: ${p.source}`);
        if (p.fields.length > 0) {
          console.log(`      fields:`);
          for (const f of p.fields) {
            console.log(`        offset ${f.slotOffset}: ${f.type} ${f.name}`);
          }
        } else {
          console.log(`      fields: (none detected)`);
        }
      }
      console.log();
    }

    if (ns.deployed.length > 0) {
      console.log(`  Deployed (${ns.deployed.length}):`);
      for (const d of ns.deployed) {
        console.log(`    ${d.contractName}`);
        console.log(`      namespace: ${d.namespace}`);
        if (d.fields.length > 0) {
          console.log(`      fields:`);
          for (const f of d.fields) {
            console.log(`        offset ${f.slotOffset}: ${f.type} ${f.name}`);
          }
        } else {
          console.log(`      fields: (none detected)`);
        }
      }
      console.log();
    }

    if (ns.matched.length > 0) {
      console.log(`  Matched:`);
      for (const m of ns.matched) {
        const status = m.compatible ? "\x1b[32mcompatible ✓\x1b[0m" : "\x1b[31mincompatible ✗\x1b[0m";
        console.log(`    ${m.deployed.contractName} ↔ ${m.planned.contractName} (${status})`);
        console.log(`      ${m.message}`);
        console.log(`      deployed fields: ${m.deployed.fields.length}, planned fields: ${m.planned.fields.length}`);
      }
      console.log();
    }

    if (ns.missing.length > 0) {
      console.log(`  Missing from deployment:`);
      for (const m of ns.missing) {
        console.log(`    ${m.contractName}`);
        console.log(`      struct: ${m.structName}`);
        if (m.fields.length > 0) {
          console.log(`      fields:`);
          for (const f of m.fields) {
            console.log(`        offset ${f.slotOffset}: ${f.type} ${f.name}`);
          }
        } else {
          console.log(`      fields: (none detected)`);
        }
      }
      console.log();
    }

    if (ns.extra.length > 0) {
      console.log(`  Extra (not in planned source):`);
      for (const e of ns.extra) {
        console.log(`    ${e.contractName}`);
        if (e.fields.length > 0) {
          console.log(`      fields:`);
          for (const f of e.fields) {
            console.log(`        offset ${f.slotOffset}: ${f.type} ${f.name}`);
          }
        } else {
          console.log(`      fields: (none detected)`);
        }
      }
      console.log();
    }
  }
}

// --- On-chain fetch ---

async function fetchOnChainLayouts(rpcUrl: string, diamondAddress: string): Promise<StorageLayout[]> {
  const onChainLayouts: StorageLayout[] = [];

  console.log("Step 2: Fetching on-chain bytecode...");
  console.log(`  rpc: ${rpcUrl}`);
  console.log(`  diamond: ${diamondAddress}\n`);

  try {
    const { createPublicClient, http } = await import("viem");

    const client = createPublicClient({
      transport: http(rpcUrl),
    });

    const facetAddressesSelector = "0x52ef6b2c";

    const result = await client.call({
      to: diamondAddress as `0x${string}`,
      data: facetAddressesSelector as `0x${string}`,
    });

    const rawHex = result.data as string;
    if (!rawHex || rawHex === "0x") {
      throw new Error("Empty response from facetAddresses() call");
    }

    const length = parseInt(rawHex.slice(66, 130), 16);

    const facetAddresses: string[] = [];
    for (let i = 0; i < length; i++) {
      const addrStart = 130 + i * 64;
      const addr = "0x" + rawHex.slice(addrStart + 24, addrStart + 64);
      facetAddresses.push(addr);
    }

    console.log(`  found ${facetAddresses.length} facet(s)\n`);

    for (const addr of facetAddresses) {
      const bytecode = await client.getCode({ address: addr as `0x${string}` });
      if (bytecode && bytecode !== "0x") {
        const layouts = parseBytecode(bytecode, addr);
        console.log(`  facet ${addr}:`);
        console.log(`    bytecode: ${bytecode.length / 2 - 1} bytes`);
        console.log(`    storage layouts: ${layouts.length}`);
        for (const layout of layouts) {
          console.log(`      namespace: "${layout.namespace}"`);
          console.log(`        base slot: 0x${layout.baseSlot}`);
          if (layout.fields.length > 0) {
            console.log(`        fields:`);
            for (const f of layout.fields) {
              console.log(`          offset ${f.slotOffset}: ${f.type} ${f.name}`);
            }
          }
        }
        console.log();
        onChainLayouts.push(...layouts);
      }
    }

    console.log(
      `  extracted ${onChainLayouts.length} on-chain storage layout(s)\n`
    );
  } catch (err) {
    console.error(`  Error fetching on-chain data: ${err}\n`);
  }

  return onChainLayouts;
}

// --- CLI parsing ---

function parseArgs(args: string[]): {
  configPath?: string;
  chain?: string;
  rpcUrl?: string;
  diamondAddress?: string;
} {
  const result: ReturnType<typeof parseArgs> = {};

  const configIdx = args.indexOf("--config");
  if (configIdx !== -1) {
    result.configPath = args[configIdx + 1];
  }

  const chainIdx = args.indexOf("--chain");
  if (chainIdx !== -1) {
    result.chain = args[chainIdx + 1];
  }

  const rpcIdx = args.indexOf("--rpc");
  if (rpcIdx !== -1) {
    result.rpcUrl = args[rpcIdx + 1];
  }

  const addrIdx = args.indexOf("--address");
  if (addrIdx !== -1) {
    result.diamondAddress = args[addrIdx + 1];
  }

  return result;
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const { configPath, chain, rpcUrl, diamondAddress } = parseArgs(args);

  if (!configPath) {
    console.error("Usage: --config <path-to-compose.json> [--chain <chain>] [--rpc <url>] [--address <addr>]");
    process.exit(1);
  }

  console.log("Storage Validation Module\n");

  const { config, rootDir } = loadCompose(configPath);
  console.log(`Loaded compose.json: "${config.project}" (${config.framework})`);

  const diamondNames = Object.keys(config.diamonds);
  if (diamondNames.length === 0) {
    console.error("No diamonds defined in compose.json");
    process.exit(1);
  }

  const diamondName = diamondNames.length === 1 ? diamondNames[0] : null;
  if (!diamondName) {
    console.error(`Multiple diamonds defined: ${diamondNames.join(", ")}`);
    process.exit(1);
  }

  console.log(`Diamond: "${diamondName}"`);

  const resolved = resolveFacets(config, rootDir, diamondName);
  const localFacets = resolved.filter((f) => f.filePath !== null);

  console.log(`\nFacets (${resolved.length} total):`);
  for (const f of resolved) {
    const status = f.filePath ? "✓" : "○";
    const note = f.source === "registry" ? " (registry — no source)" : "";
    console.log(`  ${status} ${f.facetName} [${f.source}]${note}`);
    if (f.filePath) {
      console.log(`    → ${f.filePath}`);
    }
  }
  console.log();

  // Step 1: Parse local storage layouts
  console.log("Step 1: Parsing storage layouts from resolved facets...");
  const filePaths = localFacets.map((f) => f.filePath!);
  const localLayouts = parseSourceFiles(filePaths);
  console.log(`  found ${localLayouts.length} storage layout(s)\n`);

  if (localLayouts.length > 0) {
    console.log("  Planned layouts:");
    for (const layout of localLayouts) {
      console.log(`    ${layout.contractName}`);
      console.log(`      namespace: "${layout.namespace}"`);
      console.log(`      struct: ${layout.structName}`);
      console.log(`      base slot: 0x${layout.baseSlot}`);
      if (layout.fields.length > 0) {
        console.log(`      fields:`);
        for (const f of layout.fields) {
          console.log(`        offset ${f.slotOffset}: ${f.type} ${f.name}`);
        }
      }
    }
    console.log();
  }

  // Step 2: Fetch on-chain bytecode
  const resolvedRpc = rpcUrl || (chain ? config.chains?.[chain]?.rpc : undefined);

  let onChainLayouts: StorageLayout[] = [];
  if (resolvedRpc && diamondAddress) {
    onChainLayouts = await fetchOnChainLayouts(resolvedRpc, diamondAddress);
  } else {
    console.log("Step 2: Skipping on-chain analysis (no --rpc and --address provided)\n");
  }

  // Step 3: Compare
  console.log("Step 3: Comparing layouts...");
  console.log();
  printSeparator();

  if (onChainLayouts.length > 0) {
    console.log("  Planned vs Deployed Validation");
    console.log();
    const validation = comparePlannedVsDeployed(localLayouts, onChainLayouts);
    printDeploymentValidation(validation);

    printSeparator();
    console.log();

    console.log(`Summary: ${validation.summary.safe} safe, ${validation.summary.warnings} warnings, ${validation.summary.errors} errors`);
    process.exit(validation.summary.errors > 0 ? 1 : 0);
  } else {
    console.log("  Detected Storage Layouts");
    console.log();
    printLayouts(localLayouts);
    printSeparator();
    console.log();

    console.log("Collision Detection Results");
    console.log();
    const results = compareLayouts(localLayouts);
    printResults(results);

    printSeparator();
    const errors = results.filter((r) => r.severity === "error");
    const warnings = results.filter((r) => r.severity === "warning");
    const safe = results.filter((r) => r.severity === "safe");

    console.log(`Summary: ${safe.length} safe, ${warnings.length} warnings, ${errors.length} errors`);
    process.exit(errors.length > 0 ? 1 : 0);
  }
}

main();
