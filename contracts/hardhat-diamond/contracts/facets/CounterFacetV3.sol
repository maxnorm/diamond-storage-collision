// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title CounterFacetV3 — Incompatible upgrade of CounterFacet
/// @notice Same namespace `compose.counter`, reorders fields (step before counter)
/// @dev Old layout `{counter, step}` is NOT a prefix of `{step, counter}` → incompatible
contract CounterFacetV3 {
    event Increment(uint256 by);
    event SetStep(uint256 step);

    bytes32 private constant COUNTER_STORAGE_POSITION = keccak256("compose.counter");

    struct CounterStorage {
        uint256 step;
        uint256 counter;
    }

    function _getStorage() internal pure returns (CounterStorage storage s) {
        bytes32 position = COUNTER_STORAGE_POSITION;
        assembly {
            s.slot := position
        }
    }

    function increment() external {
        CounterStorage storage s = _getStorage();
        s.counter += s.step;
        emit Increment(s.step);
    }

    function getCounter() external view returns (uint256) {
        return _getStorage().counter;
    }

    function getStep() external view returns (uint256) {
        return _getStorage().step;
    }

    function setStep(uint256 _step) external {
        _getStorage().step = _step;
        emit SetStep(_step);
    }

    function exportSelectors() external pure returns (bytes memory) {
        return bytes.concat(
            this.increment.selector,
            this.getCounter.selector,
            this.getStep.selector,
            this.setStep.selector
        );
    }
}
