import { network } from "hardhat";

const DIAMOND = process.env.DIAMOND!;

if (!DIAMOND) {
  console.error("Usage: DIAMOND=<addr> npx hardhat run scripts/upgrade-gov.ts");
  process.exit(1);
}

const { ethers } = await network.connect();
const [signer] = await ethers.getSigners();

console.log("Adding GovernanceFacet (shared namespace: compose.counter)...");
console.log("Diamond:", DIAMOND);

const govFacet = await ethers.deployContract("GovernanceFacet", [], { signer });
console.log("GovernanceFacet:", await govFacet.getAddress());

const upgradeFacet = await ethers.getContractAt("DiamondUpgradeFacet", DIAMOND);

const tx = await upgradeFacet.upgradeDiamond(
  [await govFacet.getAddress()],                           // _addFacets
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
