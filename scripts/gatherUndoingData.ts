import { ethers, Log } from "ethers";
import * as fs from "fs";

// Script to gather data about undoing operations for loan repayments.
// Usage: Set environment variables below and run with: `npx hardhat run scripts/gatherUndoingData.ts`

// Input parameters
const RPC_URL = process.env.SP_RPC_URL ?? "http://localhost:9934?app=user-someone";
const ABI_JSON_PATH = process.env.SP_ABI_JSON_PATH ?? "abi.json";
const OUTPUT_FILE_PATH = process.env.SP_OUTPUT_FILE_PATH ?? "undoing_operations.json";
const CONTRACT_ADDRESS = process.env.SP_CONTRACT_ADDRESS ?? "0xsomeContractAddressHere";
const TIMESHIFT_BRT = parseInt(process.env.SP_TIMESHIFT_BRT ?? (-3 * 3600).toString()); // Brazil time
const PROCESSING_BATCH_SIZE = parseInt(process.env.SP_PROCESSING_BATCH_SIZE ?? "100");
const EVENT_REPAYMENT_NAME = process.env.SP_EVENT_REPAYMENT_NAME ?? "LoanRepayment";
const REPAYMENT_TX_HASHES = process.env.SP_REPAYMENT_TX_HASHES ?? `
0xsomeTxHashHereLikeBelow
0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0
`;

enum RepaymentKind {
  Ordinary = "Ordinary",
  Final = "Final",
}

// Processing error definitions with both code and message
enum ProcessingErrorCode {
  Success = 0,
  RepaymentTxNotFound = 1,
  MultipleRepaymentsInSameTx = 2,
}

interface ProcessingError {
  code: ProcessingErrorCode;
  message: string;
}

interface Context {
  provider: ethers.JsonRpcProvider;
  contract: ethers.Contract;
  eventRepaymentFirstTopic: string;
}

interface RepaymentLog {
  txHash: string;
  index: number;
  loanId: number;
  repayer: string;
  borrower: string;
  repaymentAmount: bigint;
  trackedBalance: bigint;
}

interface UndoingOperation {
  originalRepaymentTxHash: string;
  originalBlockNumber: number;
  originalRepaymentLogIndex: number;
  originalRepaymentAmount: bigint;
  originalRepaymentTimestampUTC: number;
  originalRepaymentTimestampBRT: number;
  originalRepaymentKind: string;
  loanId: number;
  borrower: string;
  repayer: string;
  trackedBalanceBeforeRepayment: bigint;
  trackedBalanceAfterRepayment: bigint;
  otherRepaymentsSameBlockTxHashes: string[];
  otherRepaymentsTotal: bigint;
  undoingRepaymentAmount: bigint;
  undoingRepaymentTimestamp: number;
  processingErrorCode: number;
  processingErrorMessage: string;
}

interface SpecialEventFilter {
  fromBlock: number;
  toBlock: number;
  address: string;
  topics: string[];
}

const HASH_LENGTH_IN_BYTES = 32;
const ProcessingErrors: Record<ProcessingErrorCode, ProcessingError> = {
  [ProcessingErrorCode.Success]: {
    code: ProcessingErrorCode.Success,
    message: "Success",
  },
  [ProcessingErrorCode.RepaymentTxNotFound]: {
    code: ProcessingErrorCode.RepaymentTxNotFound,
    message: "The repayment transaction was not found",
  },
  [ProcessingErrorCode.MultipleRepaymentsInSameTx]: {
    code: ProcessingErrorCode.MultipleRepaymentsInSameTx,
    message: "There are multiple repayments in the same transaction for the same loan ID",
  },
} as const;

function createUndoingOperation(txHash?: string): UndoingOperation {
  return {
    originalRepaymentTxHash: txHash ?? "<undefind>",
    originalBlockNumber: 0,
    originalRepaymentLogIndex: 0,
    originalRepaymentAmount: 0n,
    originalRepaymentTimestampUTC: 0,
    originalRepaymentTimestampBRT: 0,
    originalRepaymentKind: "",
    loanId: -1,
    borrower: "<undefined>",
    repayer: "<undefined>",
    trackedBalanceBeforeRepayment: 0n,
    trackedBalanceAfterRepayment: 0n,
    otherRepaymentsSameBlockTxHashes: [],
    otherRepaymentsTotal: 0n,
    undoingRepaymentAmount: 0n,
    undoingRepaymentTimestamp: 0,
    processingErrorCode: ProcessingErrorCode.Success,
    processingErrorMessage: ProcessingErrors[ProcessingErrorCode.Success].message,
  };
}

async function main() {
  console.log(`🔍 Gathering undoing operations for the following transactions: ${REPAYMENT_TX_HASHES}`);
  console.log(`  📝 Using RPC URL: ${RPC_URL}`);
  console.log(`  📝 Using ABI JSON path: ${ABI_JSON_PATH}`);
  console.log(`  📝 Using output file path: ${OUTPUT_FILE_PATH}`);
  console.log(`  📝 Using contract address: ${CONTRACT_ADDRESS}`);
  console.log(`  📝 Using timeshift BRT: ${TIMESHIFT_BRT}`);
  console.log(`  📝 Using event repayment name: ${EVENT_REPAYMENT_NAME}`);
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const abi = JSON.parse(fs.readFileSync(ABI_JSON_PATH, "utf8"));
  const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);

  const txHashes = splitToStringArray(REPAYMENT_TX_HASHES);
  console.log(`  📝 Number of transactions to process: ${txHashes.length}`);
  const eventRepaymentFirstTopic = contract.interface.getEvent(EVENT_REPAYMENT_NAME)?.topicHash;
  if (!eventRepaymentFirstTopic) {
    throw new Error(`Event ${EVENT_REPAYMENT_NAME} not found in ABI`);
  }

  const context: Context = {
    provider,
    contract,
    eventRepaymentFirstTopic,
  };

  const undoingOperations: UndoingOperation[] = [];
  const totalBatches = Math.ceil(txHashes.length / PROCESSING_BATCH_SIZE);

  // Process transactions in batches
  for (let batchStart = 0; batchStart < txHashes.length; batchStart += PROCESSING_BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + PROCESSING_BATCH_SIZE, txHashes.length);
    const batch = txHashes.slice(batchStart, batchEnd);
    const batchNumber = Math.floor(batchStart / PROCESSING_BATCH_SIZE) + 1;

    console.log(
      `\n📦 Processing batch ${batchNumber}/${totalBatches} ` +
      `(transactions ${batchStart + 1}-${batchEnd} of ${txHashes.length})...`,
    );

    // Create promises for parallel processing
    const batchPromises = batch.map(async (txHash, index) => {
      const globalIndex = batchStart + index;
      const result = await gatherUndoingOperation(txHash, context);
      return { index: globalIndex, result, txHash };
    });

    // Wait for all promises in the batch to complete
    const batchResults = await Promise.all(batchPromises);

    // Sort by index to maintain order and log results
    batchResults.sort((a, b) => a.index - b.index);
    batchResults.forEach(({ index, result, txHash }) => {
      console.log(`  ✅ Transaction ${index + 1}/${txHashes.length} processed: ${txHash}`);
      undoingOperations.push(result);
    });

    console.log(`✅ Batch ${batchNumber}/${totalBatches} completed`);
  }

  fs.writeFileSync(
    OUTPUT_FILE_PATH,
    JSON.stringify(undoingOperations, bigintReplacer, 2),
  );
  console.log(`🎉 All transactions processed. Undoing operations saved to "${OUTPUT_FILE_PATH}"`);
}

function splitToStringArray(itemsString: string): string[] {
  const stringArray: string[] = itemsString.split(/[^0-9a-z]+/ig);
  return stringArray.filter(s => s.length > 0);
}

function setProcessingError(operation: UndoingOperation, errorCode: ProcessingErrorCode): void {
  const error = ProcessingErrors[errorCode];
  operation.processingErrorCode = error.code;
  operation.processingErrorMessage = error.message;
}

async function gatherUndoingOperation(txHash: string, context: Context): Promise<UndoingOperation> {
  const undoingOperation = await getUndoingOperation(txHash, context);
  await processUndoingOperation(undoingOperation, context);
  return undoingOperation;
}

async function getUndoingOperation(txHash: string, context: Context): Promise<UndoingOperation> {
  const tx = await context.provider.getTransaction(txHash);
  const undoingOperation = createUndoingOperation(txHash);
  const txReceipt = await context.provider.getTransactionReceipt(txHash);
  if (!tx || !txReceipt) {
    setProcessingError(undoingOperation, ProcessingErrorCode.RepaymentTxNotFound);
    return undoingOperation;
  }
  const block = await context.provider.getBlock(txReceipt.blockNumber);
  if (!block) {
    throw new Error(`Block ${txReceipt.blockNumber} not found in the blockchain`);
  }
  const repaymentLogs = getRepaymentLogs(txReceipt.logs, context);
  if (repaymentLogs.length === 0) {
    throw new Error(`No repayment logs found in the transaction ${txHash}`);
  }
  if (repaymentLogs.length > 1) {
    setProcessingError(undoingOperation, ProcessingErrorCode.MultipleRepaymentsInSameTx);
    return undoingOperation;
  }
  const repaymentLog = repaymentLogs[0];
  undoingOperation.originalBlockNumber = txReceipt.blockNumber;
  undoingOperation.originalRepaymentLogIndex = repaymentLog.index;
  undoingOperation.originalRepaymentAmount = repaymentLog.repaymentAmount;
  undoingOperation.originalRepaymentTimestampUTC = block?.timestamp ?? 0;
  undoingOperation.originalRepaymentTimestampBRT = undoingOperation.originalRepaymentTimestampUTC + TIMESHIFT_BRT;
  if (repaymentLog.trackedBalance === 0n) {
    undoingOperation.originalRepaymentKind = RepaymentKind.Final;
  } else {
    undoingOperation.originalRepaymentKind = RepaymentKind.Ordinary;
  }
  undoingOperation.trackedBalanceAfterRepayment = repaymentLog.trackedBalance;
  undoingOperation.loanId = repaymentLog.loanId;
  undoingOperation.borrower = repaymentLog.borrower;
  undoingOperation.repayer = repaymentLog.repayer;
  return undoingOperation;
}

async function processUndoingOperation(undoingOperation: UndoingOperation, context: Context): Promise<void> {
  if (undoingOperation.processingErrorCode !== ProcessingErrorCode.Success) {
    return;
  }
  const loanIdAsTopic = ethers.toBeHex(undoingOperation.loanId, HASH_LENGTH_IN_BYTES);

  const filter: SpecialEventFilter = {
    fromBlock: undoingOperation.originalBlockNumber,
    toBlock: undoingOperation.originalBlockNumber,
    address: CONTRACT_ADDRESS,
    topics: [
      context.eventRepaymentFirstTopic,
      loanIdAsTopic,
    ],
  };

  const logs = await context.provider.getLogs(filter);
  checkLogs(logs, filter);
  const otherRepaymentLogs = getRepaymentLogs(logs, context)
    .filter((log: RepaymentLog) => log.txHash !== undoingOperation.originalRepaymentTxHash)
    .filter((log: RepaymentLog) => log.index < undoingOperation.originalRepaymentLogIndex);

  undoingOperation.otherRepaymentsSameBlockTxHashes = otherRepaymentLogs.map((log: RepaymentLog) => log.txHash);
  undoingOperation.otherRepaymentsTotal = otherRepaymentLogs.reduce(
    (acc: bigint, log: RepaymentLog) => acc + log.repaymentAmount, 0n,
  );

  const previousBlockNumber = undoingOperation.originalBlockNumber - 1;
  const loanPreview = await context.contract.getLoanPreview(
    undoingOperation.loanId,
    undoingOperation.originalRepaymentTimestampBRT,
    { blockTag: ethers.toBeHex(previousBlockNumber) },
  );
  undoingOperation.trackedBalanceBeforeRepayment = loanPreview.trackedBalance;

  if (undoingOperation.originalRepaymentKind === RepaymentKind.Ordinary) {
    undoingOperation.undoingRepaymentAmount = undoingOperation.originalRepaymentAmount;
  } else {
    undoingOperation.undoingRepaymentAmount =
      undoingOperation.trackedBalanceBeforeRepayment - undoingOperation.otherRepaymentsTotal;
  }
  undoingOperation.undoingRepaymentTimestamp = undoingOperation.originalRepaymentTimestampBRT;
  setProcessingError(undoingOperation, ProcessingErrorCode.Success);
}

function getRepaymentLogs(logs: readonly Log[], context: Context): RepaymentLog[] {
  const repaymentLogs: RepaymentLog[] = [];
  for (const log of logs) {
    const repaymentLog = context.contract.interface.parseLog(log);
    if (repaymentLog?.name === EVENT_REPAYMENT_NAME) {
      repaymentLogs.push({
        txHash: log.transactionHash,
        index: log.index,
        loanId: repaymentLog.args.loanId,
        repayer: repaymentLog.args.repayer,
        borrower: repaymentLog.args.borrower,
        repaymentAmount: repaymentLog.args.repaymentAmount,
        trackedBalance: repaymentLog.args.trackedBalance,
      });
    }
  }
  return repaymentLogs;
}

function checkLogs(logs: readonly Log[], filter: SpecialEventFilter): void {
  if (logs.length == 0) {
    throw new Error(`No logs found in the blockchain for the filter ${JSON.stringify(filter)}`);
  }
  let wrongLog = logs.find((log: Log) => (
    log.blockNumber < filter.fromBlock ||
    log.blockNumber > filter.toBlock
  ));
  if (wrongLog) {
    throw new Error(
      `A log that block number is out of the range was found in the blockchain. ` +
      `Filter: ${JSON.stringify(filter)}. Wrong log: ${JSON.stringify(wrongLog)}`,
    );
  }
  wrongLog = logs.find((log: Log) => (
    log.address.toLowerCase() !== filter.address.toLowerCase()
  ));
  if (wrongLog) {
    throw new Error(`A log that address is not the same as the filter was found in the blockchain. ` +
      `Filter: ${JSON.stringify(filter)}. Wrong log: ${JSON.stringify(wrongLog)}`);
  }
  wrongLog = logs.find((log: Log) => (
    log.topics[0].toLowerCase() !== filter.topics[0].toLowerCase()
  ));
  if (wrongLog) {
    throw new Error(`A log that topic 0 is not the same as the filter was found in the blockchain. ` +
      `Filter: ${JSON.stringify(filter)}. Wrong log: ${JSON.stringify(wrongLog)}`);
  }
  wrongLog = logs.find((log: Log) => (
    log.topics[1].toLowerCase() !== filter.topics[1].toLowerCase()
  ));
  if (wrongLog) {
    throw new Error(`A log that topic 1 is not the same as the filter was found in the blockchain. ` +
      `Filter: ${JSON.stringify(filter)}. Wrong log: ${JSON.stringify(wrongLog)}`);
  }
}

function bigintReplacer<T>(_: string, value: T): T | number | string {
  if (typeof value === "bigint") {
    if (value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)) {
      return Number(value);
    }
    return value.toString();
  }
  return value;
}

main().catch((err) => {
  throw err;
});
