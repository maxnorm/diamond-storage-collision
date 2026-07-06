export type StorageField = {
  name: string;
  type: string;
  slotOffset: number;
};

export type StorageLayout = {
  namespace: string;
  baseSlot: string;
  structName: string;
  fields: StorageField[];
  source: string;
  contractName: string;
  origin: "local" | "on-chain";
};

export type CollisionResult = {
  namespace: string;
  compatible: boolean;
  severity: "safe" | "warning" | "error";
  message: string;
  layouts: Array<{
    contract: string;
    fields: StorageField[];
    origin: "local" | "on-chain";
  }>;
};

export type MatchedPair = {
  planned: StorageLayout;
  deployed: StorageLayout;
  compatible: boolean;
  message: string;
};

export type NamespaceValidation = {
  namespace: string;
  planned: StorageLayout[];
  deployed: StorageLayout[];
  matched: MatchedPair[];
  missing: StorageLayout[];
  extra: StorageLayout[];
  status: "safe" | "warning" | "error";
};

export type DeploymentValidation = {
  namespaces: NamespaceValidation[];
  summary: { safe: number; warnings: number; errors: number };
};
