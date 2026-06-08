// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title TokenFacet — Separate namespace
/// @notice Uses `compose.token` namespace, distinct from `compose.counter`
/// @dev Tests: new namespace detection (no collision), mapping handling in bytecode analysis
contract TokenFacet {
    event Transfer(address indexed from, address indexed to, uint256 amount);

    bytes32 private constant TOKEN_STORAGE_POSITION = keccak256("compose.token");

    struct TokenStorage {
        mapping(address => uint256) balances;
        uint256 totalSupply;
    }

    function _getStorage() internal pure returns (TokenStorage storage s) {
        bytes32 position = TOKEN_STORAGE_POSITION;
        assembly {
            s.slot := position
        }
    }

    function mint(address _to, uint256 _amount) external {
        TokenStorage storage s = _getStorage();
        s.balances[_to] += _amount;
        s.totalSupply += _amount;
        emit Transfer(address(0), _to, _amount);
    }

    function balanceOf(address _owner) external view returns (uint256) {
        return _getStorage().balances[_owner];
    }

    function totalSupply() external view returns (uint256) {
        return _getStorage().totalSupply;
    }

    function exportSelectors() external pure returns (bytes memory) {
        return bytes.concat(
            this.mint.selector,
            this.balanceOf.selector,
            this.totalSupply.selector
        );
    }
}
