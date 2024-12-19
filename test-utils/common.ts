import { expect } from "chai";
import { network } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

export function checkEquality<T extends Record<string, unknown>>(actualObject: T, expectedObject: T, index?: number) {
  const indexString = index == null ? "" : ` with index: ${index}`;
  Object.keys(expectedObject).forEach(property => {
    const value = actualObject[property];
    if (typeof value === "undefined" || typeof value === "function") {
      throw Error(`Property "${property}" is not found in the actual object` + indexString);
    }
    expect(value).to.eq(
      expectedObject[property],
      `Mismatch in the "${property}" property between the actual object and expected one` + indexString
    );
  });
}

export async function setUpFixture<T>(func: () => Promise<T>): Promise<T> {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

export function maxUintForBits(numberOfBits: number): bigint {
  return 2n ** BigInt(numberOfBits) - 1n;
}

export function roundMath(value: bigint | number, accuracy: bigint | number): bigint {
  const accuracyBI = BigInt(accuracy);
  return ((BigInt(value) + accuracyBI / 2n) / accuracyBI) * accuracyBI;
}
