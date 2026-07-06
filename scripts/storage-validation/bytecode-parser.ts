import type { StorageField, StorageLayout } from "./types.js";
import { keccak256Hex } from "./keccak256.js";

// Known namespace keccak256 values (computed from keccak256("namespace"))
// We'll generate these dynamically, but also keep a static map for common ones
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
      KNOWN_NAMESPACES[keccak256Hex(ns)] = ns;
    }
  }

  return KNOWN_NAMESPACES;
}

// --- EVM Opcode constants ---

const OP = {
  STOP: 0x00,
  ADD: 0x01,
  MUL: 0x02,
  SUB: 0x03,
  DIV: 0x04,
  PUSH1: 0x60,
  PUSH2: 0x61,
  PUSH4: 0x63,
  PUSH32: 0x7f,
  DUP1: 0x80,
  DUP2: 0x81,
  DUP3: 0x82,
  DUP4: 0x83,
  SWAP1: 0x90,
  SWAP2: 0x91,
  SLOAD: 0x54,
  SSTORE: 0x55,
  RETURN: 0xf3,
  REVERT: 0xfd,
  INVALID: 0xfe,
} as const;

// --- Parse bytecode into opcode stream ---

type Opcode = {
  offset: number;
  op: number;
  name: string;
  pushValue?: string; // hex value for PUSH1-PUSH32
};

function nameOp(op: number): string {
  for (const [name, code] of Object.entries(OP)) {
    if (code === op) return name;
  }
  return `OP_${op.toString(16)}`;
}

function parseOpcodes(bytecode: string): Opcode[] {
  const opcodes: Opcode[] = [];
  let i = 0;

  while (i < bytecode.length) {
    const offset = i / 2;
    const op = parseInt(bytecode.slice(i, i + 2), 16);
    i += 2;

    if (op >= OP.PUSH1 && op <= OP.PUSH32) {
      const numBytes = op - OP.PUSH1 + 1;
      const pushValue = bytecode.slice(i, i + numBytes * 2);
      opcodes.push({ offset, op, name: nameOp(op), pushValue });
      i += numBytes * 2;
    } else {
      opcodes.push({ offset, op, name: nameOp(op) });
    }
  }

  return opcodes;
}

// --- Extract slot accesses from opcodes ---

type SlotAccess = {
  baseSlot: string;  // hex (no 0x)
  offset: number;    // field offset from base
  op: "SLOAD" | "SSTORE";
};

function extractSlotAccesses(opcodes: Opcode[]): SlotAccess[] {
  const accesses: SlotAccess[] = [];
  const knownSlots = getKnownSlots();

  for (let i = 0; i < opcodes.length; i++) {
    const opc = opcodes[i];

    if (opc.op !== OP.PUSH32 || !opc.pushValue) continue;

    const slotValue = opc.pushValue;
    const namespace = knownSlots[slotValue];

    if (!namespace) continue;

    // Found a PUSH32 with a known namespace slot value
    // Now determine the field offset by looking at subsequent opcodes

    let fieldOffset = 0;
    let foundSloadOrSstore = false;

    // Scan next few opcodes for offset pattern
    for (let j = i + 1; j < Math.min(i + 10, opcodes.length); j++) {
      const next = opcodes[j];

      if (next.op === OP.SLOAD) {
        accesses.push({
          baseSlot: slotValue,
          offset: fieldOffset,
          op: "SLOAD",
        });
        foundSloadOrSstore = true;
        break;
      }

      if (next.op === OP.SSTORE) {
        accesses.push({
          baseSlot: slotValue,
          offset: fieldOffset,
          op: "SSTORE",
        });
        foundSloadOrSstore = true;
        break;
      }

      // Pattern: PUSH1 <N> ADD → field offset is N
      if (next.op === OP.PUSH1 && next.pushValue) {
        const addIdx = j + 1;
        if (addIdx < opcodes.length && opcodes[addIdx].op === OP.ADD) {
          fieldOffset = parseInt(next.pushValue, 16);
          // Continue scanning for SLOAD/SSTORE
          continue;
        }
      }

      // Pattern: PUSH2 <N> ADD → field offset is N
      if (next.op === OP.PUSH2 && next.pushValue) {
        const addIdx = j + 1;
        if (addIdx < opcodes.length && opcodes[addIdx].op === OP.ADD) {
          fieldOffset = parseInt(next.pushValue, 16);
          continue;
        }
      }

      // If we hit another PUSH32 or a JUMP, stop
      if (next.op >= OP.PUSH1 && next.op <= OP.PUSH32) break;
      if (next.op === 0x56 || next.op === 0x57) break; // JUMP, JUMPI
    }

    // Also check for the "optimized" pattern where the slot value itself
    // is base_slot + N (e.g., 0x...29 is base 0x...28 + 1)
    if (!foundSloadOrSstore && Object.keys(knownSlots).includes(slotValue)) {
      // This is a base slot access, check if it's used directly
      // (The offset 0 case is handled above)
    }
  }

  // Also detect the pattern where PUSH32 has a slot that is
  // base_slot + N (optimized by compiler)
  for (let i = 0; i < opcodes.length; i++) {
    const opc = opcodes[i];
    if (opc.op !== OP.PUSH32 || !opc.pushValue) continue;

    const slotValue = opc.pushValue;
    if (knownSlots[slotValue]) continue; // Already a base slot

    // Check if this slot is base_slot + N for any known base
    for (const [baseHex, ns] of Object.entries(knownSlots)) {
      const baseInt = BigInt("0x" + baseHex);
      const slotInt = BigInt("0x" + slotValue);

      if (slotInt > baseInt && slotInt - baseInt < 100n) {
        const offset = Number(slotInt - baseInt);

        // Check if followed by SLOAD/SSTORE
        for (let j = i + 1; j < Math.min(i + 5, opcodes.length); j++) {
          const next = opcodes[j];
          if (next.op === OP.SLOAD || next.op === OP.SSTORE) {
            accesses.push({
              baseSlot: baseHex,
              offset,
              op: next.op === OP.SLOAD ? "SLOAD" : "SSTORE",
            });
            break;
          }
          if (next.op >= OP.PUSH1 && next.op <= OP.PUSH32) break;
        }
      }
    }
  }

  return accesses;
}

// --- Main parser ---

export function parseBytecode(
  bytecodeHex: string,
  contractName: string = "Unknown"
): StorageLayout[] {
  // Remove 0x prefix if present
  const hex = bytecodeHex.startsWith("0x")
    ? bytecodeHex.slice(2)
    : bytecodeHex;

  const opcodes = parseOpcodes(hex);
  const accesses = extractSlotAccesses(opcodes);

  // Group by base slot
  const slotGroups = new Map<
    string,
    Map<number, { sload: number; sstore: number }>
  >();

  for (const acc of accesses) {
    if (!slotGroups.has(acc.baseSlot)) {
      slotGroups.set(acc.baseSlot, new Map());
    }
    const offsets = slotGroups.get(acc.baseSlot)!;
    if (!offsets.has(acc.offset)) {
      offsets.set(acc.offset, { sload: 0, sstore: 0 });
    }
    const counts = offsets.get(acc.offset)!;
    if (acc.op === "SLOAD") counts.sload++;
    else counts.sstore++;
  }

  // Build layouts
  const layouts: StorageLayout[] = [];
  const knownSlots = getKnownSlots();

  for (const [baseSlot, offsets] of slotGroups) {
    const namespace = knownSlots[baseSlot] || `unknown:${baseSlot.slice(0, 8)}...`;

    const fields: StorageField[] = [];
    const sortedOffsets = [...offsets.keys()].sort((a, b) => a - b);

    for (const offset of sortedOffsets) {
      fields.push({
        name: `field_${offset}`,
        type: "unknown",
        slotOffset: offset,
      });
    }

    layouts.push({
      namespace,
      baseSlot,
      structName: "__inferred__",
      fields,
      source: `bytecode:${contractName}`,
      contractName,
      origin: "on-chain",
    });
  }

  return layouts;
}
