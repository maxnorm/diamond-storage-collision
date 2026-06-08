// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title GovernanceFacet — Cross-facet shared namespace
/// @notice Uses the same `compose.counter` namespace as CounterFacet
/// @dev Two facets writing to the same namespace must have compatible struct layouts
contract GovernanceFacet {
    event GovernorSet(address indexed governor);

    bytes32 private constant COUNTER_STORAGE_POSITION = keccak256("compose.counter");

    struct GovernanceStorage {
        uint256 counter;
        address governor;
    }

    function _getStorage() internal pure returns (GovernanceStorage storage s) {
        bytes32 position = COUNTER_STORAGE_POSITION;
        assembly {
            s.slot := position
        }
    }

    function setGovernor(address _governor) external {
        _getStorage().governor = _governor;
        emit GovernorSet(_governor);
    }

    function getGovernor() external view returns (address) {
        return _getStorage().governor;
    }

    function governanceCounter() external view returns (uint256) {
        return _getStorage().counter;
    }

    function exportSelectors() external pure returns (bytes memory) {
        return bytes.concat(
            this.setGovernor.selector,
            this.getGovernor.selector,
            this.governanceCounter.selector
        );
    }
}
