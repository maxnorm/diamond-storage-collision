import { network } from "hardhat";

const DIAMOND = process.env.DIAMOND!;
const OLD_COUNTER_FACET = process.env.OLD_COUNTER_FACET!;

if (!DIAMOND || !OLD_COUNTER_FACET) {
  console.error("Usage: DIAMOND=<addr> OLD_COUNTER_FACET=<addr> npx hardhat run scripts/upgrade-v2.ts");
  process.exit(1);
}

const { ethers } = await network.connect();
const [signer] = await ethers.getSigners();

console.log("Upgrading to CounterFacetV2 (append-safe)...");
console.log("Diamond:", DIAMOND);
console.log("Old CounterFacet:", OLD_COUNTER_FACET);

const newFacet = await ethers.deployContract("CounterFacetV2", [], { signer });
console.log("New CounterFacetV2:", await newFacet.getAddress());

const upgradeFacet = await ethers.getContractAt("DiamondUpgradeFacet", DIAMOND);

const tx = await upgradeFacet.upgradeDiamond(
  [],                                                      // _addFacets
  [{ oldFacet: OLD_COUNTER_FACET, newFacet: await newFacet.getAddress() }], // _replaceFacets
  [],                                                      // _removeFacets
  ethers.ZeroAddress,                                      // _delegate
  "0x",                                                    // _delegateCalldata
  ethers.ZeroHash,                                         // _tag
  "0x"                                                     // _metadata
);

console.log("TX hash:", tx.hash);
await tx.wait();
console.log("Upgrade complete.");
