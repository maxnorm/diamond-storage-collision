import { network } from "hardhat";

const DIAMOND = process.env.DIAMOND!;

if (!DIAMOND) {
  console.error("Usage: DIAMOND=<addr> npx hardhat run scripts/upgrade-token.ts");
  process.exit(1);
}

const { ethers } = await network.connect();
const [signer] = await ethers.getSigners();

console.log("Adding TokenFacet (new namespace: compose.token)...");
console.log("Diamond:", DIAMOND);

const tokenFacet = await ethers.deployContract("TokenFacet", [], { signer });
console.log("TokenFacet:", await tokenFacet.getAddress());

const upgradeFacet = await ethers.getContractAt("DiamondUpgradeFacet", DIAMOND);

const tx = await upgradeFacet.upgradeDiamond(
  [await tokenFacet.getAddress()],                         // _addFacets
  [],                                                      // _replaceFacets
  [],                                                      // _removeFacets
  ethers.ZeroAddress,                                      // _delegate
  "0x",                                                    // _delegateCalldata
  ethers.ZeroHash,                                         // _tag
  "0x"                                                     // _metadata
);

console.log("TX hash:", tx.hash);
await tx.wait();
console.log("Upgrade complete.");
