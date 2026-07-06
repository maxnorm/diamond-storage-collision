# Storage Validation Module (sevm version)

Prototype module for detecting storage layout collisions in diamond contracts (EIP-2535).

This version uses [sevm](https://github.com/acuarica/evm) (symbolic EVM) for bytecode analysis instead of the custom opcode scanner in the original `storage-validation/` module.

## Setup

```bash
cd diamond-storage-collision-v2
npm install
npm install sevm  # sevm dependency
```

## Usage

```bash
npx tsx scripts/storage-validation-sevm/run.ts \
  --config <path-to-compose.json> \
  [--chain <chain>] \
  [--rpc <rpc-url>] \
  [--address <diamond-address>]
```

Example:

```bash
npx tsx scripts/storage-validation-sevm/run.ts \
  --config ./contracts/foundry-diamond/compose.json \
  --chain local \
  --rpc http://127.0.0.1:8545 \
  --address 0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9
```

Flags:
- `--config` — path to `compose.json`
- `--chain` — chain key from `compose.json` → `chains` (optional, resolves RPC URL)
- `--rpc` — RPC URL (optional, overrides chain config)
- `--address` — deployed diamond address (required for on-chain comparison)

Without `--rpc` and `--address`, runs local-only storage layout analysis.

## What it detects

| Scenario | Detection |
|----------|-----------|
| Append-safe upgrade (`{a}` → `{a, b}`) | Safe |
| Field reorder (`{a, b}` → `{b, a}`) | Error |
| Field insert (`{a, b}` → `{a, c, b}`) | Error |
| Type mismatch at same offset (`uint256` vs `address`) | Error |
| Cross-facet same namespace | Compared pairwise |
| Different namespace | Safe (isolated slots) |

## Storage slot detection

Source parser uses a fallback chain:

1. `@custom:storage-location erc8042:<namespace>` annotation (preferred)
2. `.slot :=` assembly pattern with `keccak256("namespace")` (fallback)

## Facet source resolution

### Local facets

Resolved relative to the compose.json directory. Contract field format:
`"src/facets/CounterFacet.sol:CounterFacet"`

### Package facets

Resolved from the forge library path using `remappings.txt`. The `contract` field
is the Solidity contract name (e.g., `"DiamondInspectFacet"`), and the script
searches the mapped library directory for the matching `.sol` file.

### Registry facets

Skipped (no source to parse). Marked in output as registry-sourced.

## Limitations

Bytecode analysis (on-chain) cannot detect:

- Field reorder (same offsets, different ordering)
- Type mismatches (bytecode is untyped)
- Mapping access via SHA3 when the compiler optimizer produces complex symbolic expressions

Use source-level analysis for full collision detection.

## Local chain testing

### Foundry (Anvil)

```bash
# Terminal 1: start Anvil
anvil

# Terminal 2: deploy and test
cd contracts/foundry-diamond

# Build
forge build

# Deploy V1
forge script script/Deploy.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# Run validation
npx tsx ../../scripts/storage-validation-sevm/run.ts \
  --config ./compose.json \
  --chain local \
  --rpc http://127.0.0.1:8545 \
  --address <DIAMOND_ADDRESS>
```

### Hardhat

```bash
# Terminal 1: start Hardhat node (JSON-RPC on :8545)
cd contracts/hardhat-diamond
npx hardhat node

# Terminal 2: deploy and test
cd contracts/hardhat-diamond

# Build
npx hardhat compile

# Deploy V1 to local node
npx hardhat run scripts/deploy-diamond.ts --network localhost

# Run validation (with --rpc and --address flags)
npx tsx ../../scripts/storage-validation-sevm/run.ts \
  --config ./compose.json \
  --rpc http://127.0.0.1:8545 \
  --address <DIAMOND_ADDRESS>
```

> **Note:** Hardhat's `hardhatMainnet` is an in-process simulated network — no JSON-RPC endpoint exposed. Use `npx hardhat node` + `--network localhost` to get a local RPC server.

## Modules

| File | Purpose |
|------|---------|
| `types.ts` | Shared type definitions |
| `keccak256.ts` | keccak256 utility (via viem) |
| `compose-loader.ts` | Load and parse `compose.json` |
| `facet-resolver.ts` | Resolve facet source paths from compose config |
| `parse-remappings.ts` | Parse Foundry `remappings.txt` |
| `source-parser.ts` | Parse `.sol` files → storage layouts |
| `sevm-parser.ts` | Parse EVM bytecode via sevm symbolic execution |
| `layout-comparator.ts` | Compare layouts, detect collisions |
| `run.ts` | CLI script chaining all modules |

## Comparison with original

| Aspect | Original (`storage-validation`) | sevm version (`storage-validation-sevm`) |
|--------|--------------------------------|------------------------------------------|
| Bytecode parser | 289 lines custom opcode scanner | ~100 lines using sevm |
| Mapping detection | Not possible (scan-window) | Partial (sevm detects some patterns) |
| Dependency | None (pure viem) | sevm (~65KB + js-sha3) |
| Field types | All `"unknown"` | Some inferred from sevm |
| Accuracy | ~60% (misses mappings) | ~70% (better variable detection) |
cd