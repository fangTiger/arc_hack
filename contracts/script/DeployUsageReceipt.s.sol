// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../src/UsageReceipt.sol";

contract DeployUsageReceiptScript {
    function run() external returns (UsageReceipt deployed) {
        deployed = new UsageReceipt();
    }
}
