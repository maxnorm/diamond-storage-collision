import type { StorageLayout, StorageField, CollisionResult, NamespaceValidation, DeploymentValidation, MatchedPair } from "./types.js";

// --- Compare two field arrays for prefix compatibility ---

function compareFields(
  oldFields: StorageField[],
  newFields: StorageField[],
  oldLabel: string,
  newLabel: string
): { compatible: boolean; message: string } {
  // Build offset → field maps for subset matching
  const oldByOffset = new Map(oldFields.map((f) => [f.slotOffset, f]));
  const newByOffset = new Map(newFields.map((f) => [f.slotOffset, f]));

  // Check that every old (deployed) field has a matching new (planned) field at the same offset
  for (const [offset, oldField] of oldByOffset) {
    const newField = newByOffset.get(offset);
    if (!newField) {
      return {
        compatible: false,
        message: `Deployed field at offset ${offset} (${oldLabel}) not found in planned layout (${newLabel})`,
      };
    }

    // Skip type check if either type is unknown (from bytecode analysis)
    if (oldField.type === "unknown" || newField.type === "unknown") {
      continue;
    }

    if (oldField.type !== newField.type) {
      return {
        compatible: false,
        message: `Type mismatch at offset ${offset}: ${oldLabel} has "${oldField.type}", ${newLabel} has "${newField.type}"`,
      };
    }
  }

  // If new (planned) has more fields, check that extra fields are appended safely
  if (newFields.length > oldFields.length) {
    // New fields appended — this is append-safe
    const lastOldOffset =
      oldFields.length > 0 ? oldFields[oldFields.length - 1].slotOffset : -1;
    const firstNewExtraOffset = newFields[oldFields.length].slotOffset;

    if (firstNewExtraOffset <= lastOldOffset) {
      return {
        compatible: false,
        message: `New fields inserted at offset ${firstNewExtraOffset}, but existing fields go up to offset ${lastOldOffset}`,
      };
    }

    return {
      compatible: true,
      message: `Append-safe: ${oldLabel} has ${oldFields.length} fields, ${newLabel} has ${newFields.length} fields (${newFields.length - oldFields.length} new appended)`,
    };
  }

  // Same length but different offsets — field reorder detected
  if (newFields.length === oldFields.length) {
    const offsetsDiffer = oldFields.some(
      (f, i) => f.slotOffset !== newFields[i].slotOffset
    );
    if (offsetsDiffer) {
      return {
        compatible: false,
        message: `Field reorder detected: same number of fields (${oldFields.length}) but at different offsets`,
      };
    }
  }

  if (newFields.length < oldFields.length) {
    return {
      compatible: false,
      message: `Layout reduced: ${oldLabel} has ${oldFields.length} fields, ${newLabel} has ${newFields.length} fields`,
    };
  }

  // Same length, all offsets match
  return {
    compatible: true,
    message: `Identical layout: ${oldFields.length} fields at same offsets`,
  };
}

// --- Main comparator ---

export function compareLayouts(layouts: StorageLayout[]): CollisionResult[] {
  const results: CollisionResult[] = [];

  // Group by namespace
  const byNamespace = new Map<string, StorageLayout[]>();
  for (const layout of layouts) {
    if (!byNamespace.has(layout.namespace)) {
      byNamespace.set(layout.namespace, []);
    }
    byNamespace.get(layout.namespace)!.push(layout);
  }

  for (const [namespace, nsLayouts] of byNamespace) {
    if (nsLayouts.length === 1) {
      // Single layout — no collision possible
      results.push({
        namespace,
        compatible: true,
        severity: "safe",
        message: `Single layout for namespace "${namespace}" — no collision risk`,
        layouts: nsLayouts.map((l) => ({
          contract: l.contractName,
          fields: l.fields,
          origin: l.origin,
        })),
      });
      continue;
    }

    // Multiple layouts — check all pairs
    // Sort: on-chain first (as "old"), then local (as "new")
    const sorted = [...nsLayouts].sort((a, b) => {
      if (a.origin === "on-chain" && b.origin === "local") return -1;
      if (a.origin === "local" && b.origin === "on-chain") return 1;
      return 0;
    });

    let allCompatible = true;
    let worstMessage = "";

    // Compare each pair
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];

        const comparison = compareFields(a.fields, b.fields, a.contractName, b.contractName);

        if (!comparison.compatible) {
          allCompatible = false;
          worstMessage = comparison.message;
        }
      }
    }

    if (allCompatible) {
      results.push({
        namespace,
        compatible: true,
        severity: "safe",
        message: `All ${sorted.length} layouts in "${namespace}" are compatible`,
        layouts: sorted.map((l) => ({
          contract: l.contractName,
          fields: l.fields,
          origin: l.origin,
        })),
      });
    } else {
      results.push({
        namespace,
        compatible: false,
        severity: "error",
        message: worstMessage,
        layouts: sorted.map((l) => ({
          contract: l.contractName,
          fields: l.fields,
          origin: l.origin,
        })),
      });
    }
  }

  return results;
}

// --- Planned vs Deployed validation ---

/**
 * Check if a deployed layout matches a planned layout.
 * Match criteria: same base slot and deployed fields are a subset of planned fields.
 */
function layoutsMatch(deployed: StorageLayout, planned: StorageLayout): boolean {
  if (deployed.baseSlot !== planned.baseSlot) return false;

  // All deployed field offsets must exist in the planned layout
  const plannedOffsets = new Set(planned.fields.map((f) => f.slotOffset));
  for (const dField of deployed.fields) {
    if (!plannedOffsets.has(dField.slotOffset)) {
      return false;
    }
  }

  return true;
}

/**
 * Compare planned layouts (from source) against deployed layouts (from bytecode).
 * Reports matched pairs, missing layouts, and extra layouts per namespace.
 */
export function comparePlannedVsDeployed(
  planned: StorageLayout[],
  deployed: StorageLayout[]
): DeploymentValidation {
  const namespaces = new Map<string, NamespaceValidation>();

  // Group planned layouts by namespace
  for (const layout of planned) {
    if (!namespaces.has(layout.namespace)) {
      namespaces.set(layout.namespace, {
        namespace: layout.namespace,
        planned: [],
        deployed: [],
        matched: [],
        missing: [],
        extra: [],
        status: "safe",
      });
    }
    namespaces.get(layout.namespace)!.planned.push(layout);
  }

  // Group deployed layouts by namespace
  for (const layout of deployed) {
    if (!namespaces.has(layout.namespace)) {
      namespaces.set(layout.namespace, {
        namespace: layout.namespace,
        planned: [],
        deployed: [],
        matched: [],
        missing: [],
        extra: [],
        status: "safe",
      });
    }
    namespaces.get(layout.namespace)!.deployed.push(layout);
  }

  // For each namespace, match deployed to planned
  for (const [, ns] of namespaces) {
    const matchedPlanned = new Set<StorageLayout>();
    const matchedDeployed = new Set<StorageLayout>();

    // Try to match each deployed layout to a planned layout
    for (const d of ns.deployed) {
      for (const p of ns.planned) {
        if (matchedPlanned.has(p)) continue;

        if (layoutsMatch(d, p)) {
          const comparison = compareFields(
            d.fields,
            p.fields,
            d.contractName,
            p.contractName
          );

          ns.matched.push({
            planned: p,
            deployed: d,
            compatible: comparison.compatible,
            message: comparison.message,
          });

          matchedPlanned.add(p);
          matchedDeployed.add(d);
          break;
        }
      }
    }

    // Collect unmatched planned (missing from deployment)
    for (const p of ns.planned) {
      if (!matchedPlanned.has(p)) {
        ns.missing.push(p);
      }
    }

    // Collect unmatched deployed (extra, not in planned)
    for (const d of ns.deployed) {
      if (!matchedDeployed.has(d)) {
        ns.extra.push(d);
      }
    }

    // Determine status
    const hasIncompatible = ns.matched.some((m) => !m.compatible);
    const hasMissing = ns.missing.length > 0;
    const hasExtra = ns.extra.length > 0;

    if (hasIncompatible) {
      ns.status = "error";
    } else if (hasMissing || hasExtra) {
      ns.status = "warning";
    } else {
      ns.status = "safe";
    }
  }

  // Build summary
  const result = [...namespaces.values()];
  const summary = {
    safe: result.filter((n) => n.status === "safe").length,
    warnings: result.filter((n) => n.status === "warning").length,
    errors: result.filter((n) => n.status === "error").length,
  };

  return { namespaces: result, summary };
}
