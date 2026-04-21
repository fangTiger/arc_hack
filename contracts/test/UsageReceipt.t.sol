// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../src/UsageReceipt.sol";

contract UsageReceiptTest {
    function testRecordReceiptStoresValues() public {
        UsageReceipt receipt = new UsageReceipt();
        bytes32 payloadHash = keccak256("demo-payload");
        bytes32 receiptId = receipt.recordReceipt("demo-001", "summary", payloadHash);
        UsageReceipt.StoredReceipt memory stored = receipt.getReceipt(receiptId);

        require(
            keccak256(bytes(stored.requestId)) == keccak256(bytes("demo-001")),
            "requestId mismatch"
        );
        require(
            keccak256(bytes(stored.operation)) == keccak256(bytes("summary")),
            "operation mismatch"
        );
        require(stored.payloadHash == payloadHash, "payloadHash mismatch");
    }
}
