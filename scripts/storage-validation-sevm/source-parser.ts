import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";
import type { StorageField, StorageLayout } from "./types.js";
import { keccak256Hex } from "./keccak256.js";

// --- Field type size (simplified: 1 slot per field) ---

function isMappingType(type: string): boolean {
  return type.startsWith("mapping");
}

function isStructType(type: string, definedStructs: Set<string>): boolean {
  return definedStructs.has(type);
}

// --- Parse struct fields ---

function parseStructFields(
  structBody: string,
  definedStructs: Set<string>
): StorageField[] {
  const fields: StorageField[] = [];
  const lines = structBody.split("\n");

  let slotOffset = 0;

  for (const line of lines) {
    const trimmed = line.trim().replace(/;$/, "").trim();
    if (!trimmed || trimmed.startsWith("//")) continue;

    // Match: type name  or  mapping(K => V) name
    const mappingMatch = trimmed.match(
      /^(mapping\s*\([^)]+\)|mapping\s*\([^)]+\)\s*(?:=>\s*\([^)]+\)|=>\s*\S+))\s+(\w+)$/
    );
    if (mappingMatch) {
      fields.push({
        name: mappingMatch[2],
        type: mappingMatch[1],
        slotOffset,
      });
      slotOffset += 1;
      continue;
    }

    // Match: type name  (e.g., uint256 counter, address governor)
    const fieldMatch = trimmed.match(/^(\S+)\s+(\w+)$/);
    if (fieldMatch) {
      fields.push({
        name: fieldMatch[2],
        type: fieldMatch[1],
        slotOffset,
      });
      slotOffset += 1;
      continue;
    }
  }

  return fields;
}

// --- Detect namespace via annotation ---

function detectNamespaceAnnotation(
  content: string
): Array<{ namespace: string; offset: number }> {
  const pattern = /@custom:storage-location\s+erc8042:([a-zA-Z0-9._-]+)/g;
  const results: Array<{ namespace: string; offset: number }> = [];
  let match;
  while ((match = pattern.exec(content)) !== null) {
    results.push({ namespace: match[1], offset: match.index });
  }
  return results;
}

// --- Detect namespace via keccak256("...") pattern ---

function detectNamespaceKeccak(
  content: string
): Array<{ namespace: string; offset: number }> {
  const pattern = /keccak256\s*\(\s*"([^"]+)"\s*\)/g;
  const results: Array<{ namespace: string; offset: number }> = [];
  let match;
  while ((match = pattern.exec(content)) !== null) {
    // Skip non-storage keccak patterns
    const ns = match[1];
    if (ns.includes("event") || ns.includes("error")) continue;
    results.push({ namespace: ns, offset: match.index });
  }
  return results;
}

// --- Find struct definitions ---

function findStructs(
  content: string
): Array<{ name: string; body: string; offset: number }> {
  const results: Array<{ name: string; body: string; offset: number }> = [];
  const structPattern = /struct\s+(\w+)\s*\{/g;
  let match;

  while ((match = structPattern.exec(content)) !== null) {
    const name = match[1];
    const bodyStart = match.index + match[0].length;
    let depth = 1;
    let pos = bodyStart;

    while (pos < content.length && depth > 0) {
      if (content[pos] === "{") depth++;
      else if (content[pos] === "}") depth--;
      pos++;
    }

    const body = content.slice(bodyStart, pos - 1);
    results.push({ name, body, offset: match.index });
  }

  return results;
}

// --- Find contract name ---

function findContractName(content: string): string | null {
  const match = content.match(
    /contract\s+(\w+)\s*(?:is\s+[^{]+)?\s*\{/
  );
  return match ? match[1] : null;
}

// --- Match annotation to struct ---

function matchAnnotationToStruct(
  annotationOffset: number,
  structs: Array<{ name: string; body: string; offset: number }>
): { name: string; body: string } | null {
  // The annotation is placed above the struct or variable declaration
  // Find the closest struct definition after the annotation
  let best: { name: string; body: string; offset: number } | null = null;
  let bestDist = Infinity;

  for (const s of structs) {
    const dist = s.offset - annotationOffset;
    if (dist > 0 && dist < bestDist) {
      bestDist = dist;
      best = s;
    }
  }

  // Allow up to 500 chars between annotation and struct
  return bestDist < 500 ? best : null;
}

// --- Match keccak256 to struct (heuristic) ---

function matchKeccakToStruct(
  keccakOffset: number,
  namespace: string,
  content: string,
  structs: Array<{ name: string; body: string; offset: number }>
): { name: string; body: string } | null {
  // Find the _getStorage function that uses this keccak
  // The pattern is: constant = keccak256("namespace")
  //                  struct UsedStruct { ... }
  //                  function _getStorage() returns (UsedStruct storage s) { ... s.slot := position }

  // Heuristic: look for the struct that appears near a _getStorage function
  // that references this namespace's constant

  // Simple approach: find the constant name, then find _getStorage that uses it
  const constPattern = new RegExp(
    `(\\w+)\\s*(?:private|internal|public)?\\s*constant\\s+\\w+\\s*=\\s*keccak256\\s*\\(\\s*"${namespace.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    )}"\\s*\\)`,
    "g"
  );
  const constMatch = constPattern.exec(content);
  if (!constMatch) return null;

  const constName = constMatch[1];

  // Find _getStorage that uses this constant
  const storageFnPattern =
    /function\s+_getStorage\b[^{]*\{([\s\S]*?)\}/g;
  let fnMatch;
  while ((fnMatch = storageFnPattern.exec(content)) !== null) {
    if (fnMatch[1].includes(constName)) {
      // Find the struct used as return type
      const retTypePattern = /returns\s*\(\s*(\w+)\s+storage\s+\w+\s*\)/;
      const retMatch = retTypePattern.exec(fnMatch[0]);
      if (retMatch) {
        const structName = retMatch[1];
        const found = structs.find((s) => s.name === structName);
        if (found) return found;
      }
    }
  }

  // Fallback: if only one struct in file, use it
  if (structs.length === 1) return structs[0];

  return null;
}

// --- Main parser ---

export function parseSourceFile(filePath: string): StorageLayout[] {
  const content = readFileSync(filePath, "utf-8");
  const contractName = findContractName(content) ?? "Unknown";
  const definedStructs = new Set(findStructs(content).map((s) => s.name));
  const structs = findStructs(content);

  const layouts: StorageLayout[] = [];

  // Method 1: ERC-8042 annotation
  const annotations = detectNamespaceAnnotation(content);
  for (const ann of annotations) {
    const struct = matchAnnotationToStruct(ann.offset, structs);
    if (struct) {
      layouts.push({
        namespace: ann.namespace,
        baseSlot: keccak256Hex(ann.namespace),
        structName: struct.name,
        fields: parseStructFields(struct.body, definedStructs),
        source: filePath,
        contractName,
        origin: "local",
      });
    }
  }

  // Method 2: keccak256("...") pattern (fallback)
  const keccaks = detectNamespaceKeccak(content);
  for (const kc of keccaks) {
    // Skip if already found via annotation
    if (layouts.some((l) => l.namespace === kc.namespace)) continue;

    const struct = matchKeccakToStruct(
      kc.offset,
      kc.namespace,
      content,
      structs
    );
    if (struct) {
      layouts.push({
        namespace: kc.namespace,
        baseSlot: keccak256Hex(kc.namespace),
        structName: struct.name,
        fields: parseStructFields(struct.body, definedStructs),
        source: filePath,
        contractName,
        origin: "local",
      });
    }
  }

  return layouts;
}

// --- Glob .sol files ---

function globSol(dir: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...globSol(fullPath));
    } else if (extname(entry) === ".sol") {
      results.push(fullPath);
    }
  }

  return results;
}

export function parseSourceDir(dirPath: string): StorageLayout[] {
  const files = globSol(dirPath);
  return parseSourceFiles(files);
}

export function parseSourceFiles(filePaths: string[]): StorageLayout[] {
  const allLayouts: StorageLayout[] = [];

  for (const file of filePaths) {
    try {
      const layouts = parseSourceFile(file);
      allLayouts.push(...layouts);
    } catch {
      // Skip files that can't be parsed
    }
  }

  return allLayouts;
}
