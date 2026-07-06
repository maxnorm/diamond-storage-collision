import { Contract } from "sevm";
import "sevm/4bytedb";
import type { StorageField, StorageLayout } from "./types.js";
import { keccak256Hex } from "./keccak256.js";

// Known namespace keccak256 values
const KNOWN_NAMESPACES: Record<string, string> = {};

function getKnownSlots(): Record<string, string> {
  if (Object.keys(KNOWN_NAMESPACES).length === 0) {
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
    for (const ns of namespaces) {
      KNOWN_NAMESPACES[keccak256Hex(ns)] = ns;
    }
  }
  return KNOWN_NAMESPACES;
}

/**
 * Find which namespace a slot belongs to.
 * Returns [namespace, offsetFromBase] or null if not a known namespace.
 */
function findNamespace(
  slot: bigint,
  knownSlots: Record<string, string>
): [string, number] | null {
  const slotHex = slot.toString(16).padStart(64, "0");

  // Direct match (slot is the base slot itself)
  if (knownSlots[slotHex]) {
    return [knownSlots[slotHex], 0];
  }

  // Check if slot is base_slot + offset for any known base
  for (const [baseHex, ns] of Object.entries(knownSlots)) {
    const baseInt = BigInt("0x" + baseHex);
    if (slot > baseInt && slot - baseInt < 100n) {
      return [ns, Number(slot - baseInt)];
    }
  }

  return null;
}

export function parseBytecode(
  bytecodeHex: string,
  contractName: string = "Unknown"
): StorageLayout[] {
  const knownSlots = getKnownSlots();

  let contract: Contract;
  try {
    contract = new Contract(bytecodeHex).patchdb();
  } catch {
    return [];
  }

  // Group fields by namespace
  const byNamespace = new Map<
    string,
    { baseSlot: string; fields: Map<number, StorageField> }
  >();

  const getOrCreate = (namespace: string, baseSlot: string) => {
    if (!byNamespace.has(namespace)) {
      byNamespace.set(namespace, { baseSlot, fields: new Map() });
    }
    return byNamespace.get(namespace)!;
  };

  // Extract concrete variable accesses
  for (const [slot, variable] of contract.variables) {
    const result = findNamespace(slot, knownSlots);
    if (!result) continue;

    const [namespace, offset] = result;
    const baseSlotHex = (
      slot - BigInt(offset)
    )
      .toString(16)
      .padStart(64, "0");
    const entry = getOrCreate(namespace, baseSlotHex);

    if (!entry.fields.has(offset)) {
      entry.fields.set(offset, {
        name: variable.label || `field_${offset}`,
        type: "unknown",
        slotOffset: offset,
      });
    }
  }

  // Extract mapping accesses
  for (const [location, mapping] of Object.entries(contract.mappings)) {
    const baseSlot = BigInt(location);
    const result = findNamespace(baseSlot, knownSlots);
    if (!result) continue;

    const [namespace] = result;
    const entry = getOrCreate(namespace, location);

    // Mapping itself is at offset 0
    if (!entry.fields.has(0)) {
      entry.fields.set(0, {
        name: `field_0`,
        type: "mapping(...)",
        slotOffset: 0,
      });
    }

    // Struct offsets within the mapping
    for (const structOffset of mapping.structs) {
      const offset = Number(structOffset);
      if (!entry.fields.has(offset)) {
        entry.fields.set(offset, {
          name: `field_${offset}`,
          type: "unknown",
          slotOffset: offset,
        });
      }
    }
  }

  // Build StorageLayout[] from grouped data
  const layouts: StorageLayout[] = [];
  for (const [namespace, { baseSlot, fields }] of byNamespace) {
    const sortedFields = [...fields.values()].sort(
      (a, b) => a.slotOffset - b.slotOffset
    );
    layouts.push({
      namespace,
      baseSlot,
      structName: "__inferred__",
      fields: sortedFields,
      source: `bytecode:${contractName}`,
      contractName,
      origin: "on-chain",
    });
  }

  return layouts;
}
