import { contractInfo } from "evmole";
import type { StorageField, StorageLayout } from "./types.js";
import { keccak256Hex } from "./keccak256.js";

// Known namespace keccak256 values (computed from keccak256("namespace"))
// Keys are WITHOUT 0x prefix for consistent matching
const KNOWN_NAMESPACES: Record<string, string> = {};

function getKnownSlots(): Record<string, string> {
  // Lazy-initialize with common Compose namespaces
  const namespaces = [
    "compose.counter",
    "compose.token",
    "compose.accesscontrol",
    "compose.accesscontrol.pausable",
    "compose.accesscontrol.temporal",
    "compose.nonreentrant",
    "erc8153.diamond",
    "erc173.owner",
    "erc173.owner.pending",
    "erc165",
    "erc20",
    "erc20.metadata",
    "erc721",
    "erc721.metadata",
    "erc721.enumerable",
    "erc1155",
    "erc1155.metadata",
    "erc6909",
    "erc2981",
    "nonces",
  ];

  if (Object.keys(KNOWN_NAMESPACES).length === 0) {
    for (const ns of namespaces) {
      // keccak256Hex returns WITHOUT 0x prefix
      KNOWN_NAMESPACES[keccak256Hex(ns)] = ns;
    }
  }

  return KNOWN_NAMESPACES;
}

// --- EVMole-based parser ---

export function parseBytecode(
  bytecodeHex: string,
  contractName: string = "Unknown"
): StorageLayout[] {
  const knownSlots = getKnownSlots();

  // Use EVMole to extract storage layout
  const result = contractInfo(bytecodeHex, { storage: true });

  if (!result.storage || result.storage.length === 0) {
    return [];
  }

  // Group storage records by base slot
  const slotGroups = new Map<
    string,
    { namespace: string; fields: StorageField[] }
  >();

  for (const record of result.storage) {
    // Parse slot value (EVMole returns hex string like "0", "1b", "0x...")
    // Normalize to WITHOUT 0x prefix for matching
    const slotNormalized = record.slot.startsWith("0x")
      ? record.slot.slice(2)
      : record.slot;
    const slotBigInt = BigInt("0x" + slotNormalized);

    // Find matching namespace
    let namespace = "unknown";
    let baseSlot = slotBigInt;
    let offset = record.offset;

    // Check exact match (base slot) - both with and without 0x prefix
    if (knownSlots[slotNormalized]) {
      namespace = knownSlots[slotNormalized];
      offset = record.offset;
    } else {
      // Check base_slot + offset pattern
      for (const [baseHex, ns] of Object.entries(knownSlots)) {
        const baseBigInt = BigInt("0x" + baseHex);
        if (slotBigInt > baseBigInt) {
          const diff = Number(slotBigInt - baseBigInt);
          // Only match if offset is 0 (meaning this is a field at base_slot + diff)
          // or if the diff is small and the record offset makes sense
          if (diff < 100 && record.offset === 0) {
            namespace = ns;
            baseSlot = baseBigInt;
            offset = diff;
            break;
          }
        }
      }
    }

    // Skip unknown namespaces
    if (namespace === "unknown") continue;

    // Build the base slot key WITHOUT 0x prefix (consistent with source parser)
    const baseSlotKey = baseSlot.toString(16).padStart(64, "0");

    if (!slotGroups.has(baseSlotKey)) {
      slotGroups.set(baseSlotKey, { namespace, fields: [] });
    }

    // Use EVMole's type if available, otherwise use field_N naming
    const fieldName = record.type.startsWith("mapping")
      ? record.type
      : `field_${offset}`;

    slotGroups.get(baseSlotKey)!.fields.push({
      name: fieldName,
      type: record.type,
      slotOffset: offset,
    });
  }

  // Convert to StorageLayout[]
  return Array.from(slotGroups.entries()).map(([baseSlot, { namespace, fields }]) => ({
    namespace,
    baseSlot,
    structName: "__inferred__",
    fields: fields.sort((a, b) => a.slotOffset - b.slotOffset),
    source: `bytecode:${contractName}`,
    contractName,
    origin: "on-chain" as const,
  }));
}
