import { ethers } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { maxUintForBits, setUpFixture } from "../../test-utils/common";

const uint256Max = maxUintForBits(256);
const int128Max = maxUintForBits(127);
const int128Min = -maxUintForBits(127) - 1n;
const int64Max = maxUintForBits(63);

const CC = 2n ** 64n; // conversion coefficient from integer to the 64.64 format

describe("Library 'ABDKMath64x64'", async () => {
  let mathFactory: ContractFactory;

  before(async () => {
    mathFactory = await ethers.getContractFactory("ABDKMath64x64Mock");
  });

  async function deployContract(): Promise<{ mathContract: Contract }> {
    const mathContract = await mathFactory.deploy() as Contract;
    await mathContract.waitForDeployment();

    return {
      mathContract,
    };
  }

  describe("Function 'fromUInt()'", async () => {
    it("Executes as expected in different cases", async () => {
      const { mathContract } = await setUpFixture(deployContract);
      expect(await mathContract.fromUInt(0)).to.eq(0);
      expect(await mathContract.fromUInt(1)).to.eq(1n << 64n);
      expect(await mathContract.fromUInt(int64Max)).to.eq(int64Max << 64n);
    });

    it("Is reverted if the value specified for conversion exceeds 64 bits", async () => {
      const { mathContract } = await setUpFixture(deployContract);
      await expect(mathContract.fromUInt(int64Max + 1n)).to.be.reverted;
    });
  });

  describe("Function 'mul()'", async () => {
    it("Executes as expected in different cases", async () => {
      const { mathContract } = await setUpFixture(deployContract);
      expect(await mathContract.mul(0n, 0n)).to.eq(0n);

      expect(await mathContract.mul(0n, int128Max)).to.eq(0);
      expect(await mathContract.mul(int128Max, 0n)).to.eq(0);
      expect(await mathContract.mul(0n, int128Min)).to.eq(0);
      expect(await mathContract.mul(int128Min, 0n)).to.eq(0);

      expect(await mathContract.mul(1n * CC, int128Max)).to.eq(int128Max);
      expect(await mathContract.mul(int128Max, 1n * CC)).to.eq(int128Max);
      expect(await mathContract.mul(1n * CC, int128Min)).to.eq(int128Min);
      expect(await mathContract.mul(int128Min, 1n * CC)).to.eq(int128Min);

      expect(await mathContract.mul(int128Max / 2n, 2n * CC)).to.eq(int128Max / 2n * 2n);
      expect(await mathContract.mul(int128Min / 2n, 2n * CC)).to.eq(int128Min / 2n * 2n);
    });

    it("Is reverted if the multiplication result exceeds 128 bits", async () => {
      const { mathContract } = await setUpFixture(deployContract);
      await expect(mathContract.mul(int128Max / 2n, 2n * CC + 1n)).to.be.reverted;
      await expect(mathContract.mul(int128Min / 2n, 2n * CC + 1n)).to.be.reverted;
    });
  });

  describe("Function 'div()'", async () => {
    it("Executes as expected in different cases", async () => {
      const { mathContract } = await setUpFixture(deployContract);
      expect(await mathContract.div(0n, 1n)).to.eq(0n);
      expect(await mathContract.div(0n, int128Max)).to.eq(0);
      expect(await mathContract.div(0n, int128Min)).to.eq(0);

      expect(await mathContract.div(int128Max, 1n * CC)).to.eq(int128Max);
      expect(await mathContract.div(int128Min, 1n * CC)).to.eq(int128Min);

      expect(await mathContract.div(int128Max / 2n, 1n * (CC / 2n))).to.eq(int128Max / 2n * 2n);
      expect(await mathContract.div(int128Min / 2n, 1n * (CC / 2n))).to.eq(int128Min / 2n * 2n);
    });

    it("Is reverted if the divisor is zero", async () => {
      const { mathContract } = await setUpFixture(deployContract);
      await expect(mathContract.div(1n, 0n)).to.be.reverted;
    });

    it("Is reverted if the division result exceeds 128 bits", async () => {
      const { mathContract } = await setUpFixture(deployContract);
      await expect(mathContract.div(int128Max / 2n, 1n * (CC / 2n) - 1n)).to.be.reverted;
      await expect(mathContract.div(int128Min / 2n, 1n * (CC / 2n) - 1n)).to.be.reverted;
    });
  });

  describe("Function 'pow()'", async () => {
    it("Executes as expected in different cases", async () => {
      const { mathContract } = await setUpFixture(deployContract);
      expect(await mathContract.pow(0n, 1n)).to.eq(0n);
      expect(await mathContract.pow(0n, 2n)).to.eq(0n);
      expect(await mathContract.pow(0n, uint256Max)).to.eq(0n);

      expect(await mathContract.pow(0n, 0n)).to.eq(1n * CC);
      expect(await mathContract.pow(1n, 0n)).to.eq(1n * CC);
      expect(await mathContract.pow(int128Max, 0n)).to.eq(1n * CC);
      expect(await mathContract.pow(int128Min, 0n)).to.eq(1n * CC);

      expect(await mathContract.pow(1n, 2n)).to.eq(0n);
      expect(await mathContract.pow(-1n, 2n)).to.eq(0n);

      expect(await mathContract.pow(1n * CC, uint256Max - 1n)).to.eq(1n * CC);
      expect(await mathContract.pow(-1n * CC, uint256Max - 1n)).to.eq(1n * CC);
      expect(await mathContract.pow(1n * CC, uint256Max)).to.eq(1n * CC);
      expect(await mathContract.pow(-1n * CC, uint256Max)).to.eq(-1n * CC);

      expect(await mathContract.pow(2n * CC, 62n)).to.eq((2n ** 62n) * CC);
      expect(await mathContract.pow(-2n * CC, 62n)).to.eq(((-2n) ** 62n) * CC);
      expect(await mathContract.pow(-2n * CC, 61n)).to.eq(((-2n) ** 61n) * CC);

      expect(await mathContract.pow(1n * CC + 1n, 2n)).to.eq(((1n * CC + 1n) ** 2n) / CC);
      expect(await mathContract.pow(-1n * CC - 1n, 2n)).to.eq(((-1n * CC - 1n) ** 2n) / CC);

      expect(await mathContract.pow(1n * CC + 1n, 3n)).to.eq(((1n * CC + 1n) ** 3n) / CC ** 2n);
      expect(await mathContract.pow(-1n * CC - 1n, 3n)).to.eq(((-1n * CC - 1n) ** 3n) / CC ** 2n);

      expect(await mathContract.pow(2n * CC - 1n, 2n)).to.eq(((2n * CC - 1n) ** 2n) / CC);
      expect(await mathContract.pow(-2n * CC + 1n, 2n)).to.eq(((-2n * CC + 1n) ** 2n) / CC);

      expect(await mathContract.pow(2n * CC - 1n, 3n)).to.eq(((2n * CC - 1n) ** 3n) / CC ** 2n);
      expect(await mathContract.pow(-2n * CC + 1n, 3n)).to.eq(((-2n * CC + 1n) ** 3n) / CC ** 2n);
    });

    it("Is reverted if overflow occurs during calculation", async () => {
      const { mathContract } = await setUpFixture(deployContract);
      await expect(mathContract.pow(2n * CC, 64n)).to.be.reverted;
      await expect(mathContract.pow(-2n * CC, 64n)).to.be.reverted;
      await expect(mathContract.pow(2n * CC - 1n, 64n)).to.be.reverted;
      await expect(mathContract.pow(-2n * CC + 1n, 64n)).to.be.reverted;
    });
  });
});
