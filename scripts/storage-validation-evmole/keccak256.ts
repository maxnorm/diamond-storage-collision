import { keccak256 as viemKeccak256, toBytes } from "viem";

export function keccak256(namespace: string): string {
  return viemKeccak256(toBytes(namespace));
}

export function keccak256Hex(namespace: string): string {
  return keccak256(namespace).slice(2);
}
