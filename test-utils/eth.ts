import { ethers, network, upgrades } from "hardhat";
import { BaseContract, BlockTag, Contract, ContractFactory, TransactionReceipt, TransactionResponse } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { time } from "@nomicfoundation/hardhat-network-helpers";

export async function proveTx(tx: Promise<TransactionResponse> | TransactionResponse): Promise<TransactionReceipt> {
  const txResponse = await tx;
  const txReceipt = await txResponse.wait();
  if (!txReceipt) {
    throw new Error("The transaction receipt is empty");
  }
  return txReceipt;
}

export function connect(contract: BaseContract, signer: HardhatEthersSigner): Contract {
  return contract.connect(signer) as Contract;
}

export async function checkContractUupsUpgrading(
  contract: Contract,
  contractFactory: ContractFactory,
) {
  const contractAddress = await contract.getAddress();
  const oldImplementationAddress = await upgrades.erc1967.getImplementationAddress(contractAddress);
  const newImplementation = await contractFactory.deploy();
  await newImplementation.waitForDeployment();
  const expectedNewImplementationAddress = await newImplementation.getAddress();

  await proveTx(contract.upgradeToAndCall(expectedNewImplementationAddress, "0x"));

  const actualNewImplementationAddress = await upgrades.erc1967.getImplementationAddress(contractAddress);
  expect(actualNewImplementationAddress).to.eq(expectedNewImplementationAddress);
  expect(actualNewImplementationAddress).not.to.eq(oldImplementationAddress);
}

export function getAddress(contract: Contract): string {
  const address = contract.target;
  if (typeof address !== "string" || address.length != 42 || !address.startsWith("0x")) {
    throw new Error("The '.target' field of the contract is not an address string");
  }
  return address;
}

export async function getTxTimestamp(tx: Promise<TransactionResponse> | TransactionResponse): Promise<number> {
  const receipt = await proveTx(tx);
  const block = await ethers.provider.getBlock(receipt.blockNumber);
  return Number(block?.timestamp ?? 0);
}

export async function getBlockTimestamp(blockTag: BlockTag): Promise<number> {
  const block = await ethers.provider.getBlock(blockTag);
  return block?.timestamp ?? 0;
}

export async function getLatestBlockTimestamp(): Promise<number> {
  return getBlockTimestamp("latest");
}

export async function increaseBlockTimestampTo(target: number) {
  if (network.name === "hardhat") {
    await time.increaseTo(target);
  } else if (network.name === "stratus") {
    await ethers.provider.send("evm_setNextBlockTimestamp", [target]);
    await ethers.provider.send("evm_mine", []);
  } else {
    throw new Error(`Setting block timestamp for the current blockchain is not supported: ${network.name}`);
  }
}

export async function getNumberOfEvents(
  tx: TransactionResponse | Promise<TransactionResponse>,
  contract: Contract,
  eventName: string,
): Promise<number> {
  const topic = contract.filters[eventName].fragment.topicHash;
  return (await proveTx(tx)).logs.filter(log => log.topics[0] == topic).length;
}

export async function deployAndConnectContract(
  contractFactory: ContractFactory,
  account: HardhatEthersSigner,
): Promise<Contract> {
  let contract = (await contractFactory.deploy()) as Contract;
  await contract.waitForDeployment();
  contract = connect(contract, account); // Explicitly specifying the initial account
  return contract;
}
