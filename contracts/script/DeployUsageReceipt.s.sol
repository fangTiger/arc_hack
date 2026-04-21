// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../src/UsageReceipt.sol";

interface Vm {
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract DeployUsageReceiptScript {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (UsageReceipt deployed) {
        vm.startBroadcast();
        deployed = new UsageReceipt();
        vm.stopBroadcast();
    }
}
