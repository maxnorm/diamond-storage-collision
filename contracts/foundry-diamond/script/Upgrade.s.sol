// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {CounterFacetV2} from "../src/facets/CounterFacetV2.sol";
import {CounterFacetV3} from "../src/facets/CounterFacetV3.sol";
import {GovernanceFacet} from "../src/facets/GovernanceFacet.sol";
import {TokenFacet} from "../src/facets/TokenFacet.sol";
import {DiamondUpgradeFacet} from "@perfect-abstractions/compose/diamond/DiamondUpgradeFacet.sol";

/// @title UpgradeScript — Upgrade diamond facets
/// @notice Usage:
///   --scenario v2    : replace CounterFacet with CounterFacetV2 (append-safe)
///   --scenario v3    : replace CounterFacet with CounterFacetV3 (incompatible)
///   --scenario gov   : add GovernanceFacet (shared namespace)
///   --scenario token : add TokenFacet (new namespace)
contract UpgradeScript is Script {
    function run() external {
        string memory scenario = vm.envOr("SCENARIO", string("v2"));

        if (_strEq(scenario, "v2")) {
            _upgradeToV2();
        } else if (_strEq(scenario, "v3")) {
            _upgradeToV3();
        } else if (_strEq(scenario, "gov")) {
            _addGovernance();
        } else if (_strEq(scenario, "token")) {
            _addToken();
        } else {
            revert("Unknown SCENARIO. Use: v2, v3, gov, token");
        }
    }

    function _upgradeToV2() internal {
        vm.startBroadcast();

        address diamondAddr = vm.envAddress("DIAMOND");
        DiamondUpgradeFacet upgrade = DiamondUpgradeFacet(diamondAddr);

        CounterFacetV2 newFacet = new CounterFacetV2();
        address oldFacet = vm.envAddress("OLD_COUNTER_FACET");

        DiamondUpgradeFacet.FacetReplacement[] memory replacements = new DiamondUpgradeFacet.FacetReplacement[](1);
        replacements[0] = DiamondUpgradeFacet.FacetReplacement(oldFacet, address(newFacet));

        upgrade.upgradeDiamond(
            new address[](0),
            replacements,
            new address[](0),
            address(0),
            bytes(""),
            bytes32(0),
            bytes("")
        );

        vm.stopBroadcast();
    }

    function _upgradeToV3() internal {
        vm.startBroadcast();

        address diamondAddr = vm.envAddress("DIAMOND");
        DiamondUpgradeFacet upgrade = DiamondUpgradeFacet(diamondAddr);

        CounterFacetV3 newFacet = new CounterFacetV3();
        address oldFacet = vm.envAddress("OLD_COUNTER_FACET");

        DiamondUpgradeFacet.FacetReplacement[] memory replacements = new DiamondUpgradeFacet.FacetReplacement[](1);
        replacements[0] = DiamondUpgradeFacet.FacetReplacement(oldFacet, address(newFacet));

        upgrade.upgradeDiamond(
            new address[](0),
            replacements,
            new address[](0),
            address(0),
            bytes(""),
            bytes32(0),
            bytes("")
        );

        vm.stopBroadcast();
    }

    function _addGovernance() internal {
        vm.startBroadcast();

        address diamondAddr = vm.envAddress("DIAMOND");
        DiamondUpgradeFacet upgrade = DiamondUpgradeFacet(diamondAddr);

        GovernanceFacet govFacet = new GovernanceFacet();

        address[] memory addFacets = new address[](1);
        addFacets[0] = address(govFacet);

        upgrade.upgradeDiamond(
            addFacets,
            new DiamondUpgradeFacet.FacetReplacement[](0),
            new address[](0),
            address(0),
            bytes(""),
            bytes32(0),
            bytes("")
        );

        vm.stopBroadcast();
    }

    function _addToken() internal {
        vm.startBroadcast();

        address diamondAddr = vm.envAddress("DIAMOND");
        DiamondUpgradeFacet upgrade = DiamondUpgradeFacet(diamondAddr);

        TokenFacet tokenFacet = new TokenFacet();

        address[] memory addFacets = new address[](1);
        addFacets[0] = address(tokenFacet);

        upgrade.upgradeDiamond(
            addFacets,
            new DiamondUpgradeFacet.FacetReplacement[](0),
            new address[](0),
            address(0),
            bytes(""),
            bytes32(0),
            bytes("")
        );

        vm.stopBroadcast();
    }

    function _strEq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}
