// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

contract UsageReceipt {
    struct StoredReceipt {
        string requestId;
        string operation;
        bytes32 payloadHash;
        uint256 recordedAt;
    }

    mapping(bytes32 => StoredReceipt) private receipts;

    event ReceiptRecorded(
        bytes32 indexed receiptId,
        string requestId,
        string operation,
        bytes32 payloadHash,
        uint256 recordedAt
    );

    function recordReceipt(
        string calldata requestId,
        string calldata operation,
        bytes32 payloadHash
    ) external returns (bytes32 receiptId) {
        receiptId = keccak256(abi.encode(requestId, operation, payloadHash));

        receipts[receiptId] = StoredReceipt({
            requestId: requestId,
            operation: operation,
            payloadHash: payloadHash,
            recordedAt: block.timestamp
        });

        emit ReceiptRecorded(receiptId, requestId, operation, payloadHash, block.timestamp);
    }

    function getReceipt(bytes32 receiptId) external view returns (StoredReceipt memory) {
        return receipts[receiptId];
    }
}
