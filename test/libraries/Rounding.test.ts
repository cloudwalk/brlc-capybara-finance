import { ethers } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { setUpFixture } from "../../test-utils/common";

describe("Library 'Rounding'", () => {
  let roundingContractFactory: ContractFactory;

  before(async () => {
    roundingContractFactory = await ethers.getContractFactory("RoundingMock");
  });

  async function deployContract(): Promise<{ roundingContract: Contract }> {
    const roundingContract = await roundingContractFactory.deploy() as Contract;
    await roundingContract.waitForDeployment();

    return {
      roundingContract,
    };
  }

  describe("Function 'roundMath()'", () => {
    it("Executes as expected in different cases", async () => {
      const { roundingContract } = await setUpFixture(deployContract);
      const accuracy = 10000;

      expect(await roundingContract.roundMath(10_4999, accuracy)).to.eq(10_0000);
      expect(await roundingContract.roundMath(10_5000, accuracy)).to.eq(11_0000);
      expect(await roundingContract.roundMath(10_0000, accuracy)).to.eq(10_0000);
    });
  });
});
