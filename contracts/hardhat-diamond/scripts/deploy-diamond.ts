import { network } from "hardhat";

const { ethers } = await network.connect();
const [signer] = await ethers.getSigners();

console.log("Deploying with account:", signer.address);

const counterFacet = await ethers.deployContract("CounterFacet", [], { signer });
const inspectFacet = await ethers.deployContract("DiamondInspectFacet", [], { signer });
const upgradeFacet = await ethers.deployContract("DiamondUpgradeFacet", [], { signer });

console.log("CounterFacet:", await counterFacet.getAddress());
console.log("DiamondInspectFacet:", await inspectFacet.getAddress());
console.log("DiamondUpgradeFacet:", await upgradeFacet.getAddress());

const diamond = await ethers.deployContract(
  "Diamond",
  [[await counterFacet.getAddress(), await inspectFacet.getAddress(), await upgradeFacet.getAddress()], signer.address],
  { signer }
);

const diamondAddr = await diamond.getAddress();
console.log("Diamond:", diamondAddr);
console.log("\nExport these for upgrade scripts:");
console.log(`DIAMOND=${diamondAddr}`);
console.log(`COUNTER_FACET=${await counterFacet.getAddress()}`);
