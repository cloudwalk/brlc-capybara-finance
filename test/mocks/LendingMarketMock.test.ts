import { ethers } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { setUpFixture } from "../../test-utils/common";
import { connect } from "../../test-utils/eth";

const ERROR_NAME_NOT_IMPLEMENTED = "NotImplemented";

const MOCK_LOAN_ID = 1;
const MOCK_PROGRAM_ID = 2;
const MOCK_ADDRESS = "0x0000000000000000000000000000000000000001";

describe("Contract 'LendingMarketMock'", async () => {
  let lendingMarketFactory: ContractFactory;

  let deployer: HardhatEthersSigner;

  before(async () => {
    [deployer] = await ethers.getSigners();

    lendingMarketFactory = await ethers.getContractFactory("LendingMarketMock");
    lendingMarketFactory = lendingMarketFactory.connect(deployer); // Explicitly specifying the deployer account
  });

  async function deployLendingMarketMock(): Promise<{ lendingMarket: Contract }> {
    let lendingMarket = await lendingMarketFactory.deploy() as Contract;
    await lendingMarket.waitForDeployment();
    lendingMarket = connect(lendingMarket, deployer); // Explicitly specifying the initial account

    return {
      lendingMarket
    };
  }

  describe("Cover unused functions", async () => {
    it("Function 'proveCreditLine()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      expect(await lendingMarket.proveLendingMarket()).to.exist;
    });
  });

  describe("Unimplemented mock functions are reverted as expected", async () => {
    it("Function 'registerCreditLine()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.registerCreditLine(MOCK_ADDRESS))
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'registerLiquidityPool()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.registerLiquidityPool(MOCK_ADDRESS))
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'createProgram()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.createProgram(MOCK_ADDRESS, MOCK_ADDRESS))
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'updateProgram()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.updateProgram(MOCK_PROGRAM_ID, MOCK_ADDRESS, MOCK_ADDRESS))
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'takeLoanFor()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.takeLoanFor(MOCK_ADDRESS, MOCK_PROGRAM_ID, 0, 0, 0))
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'takeLoan()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.takeLoan(MOCK_PROGRAM_ID, 0, 0))
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'takeInstallmentLoanFor()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.takeInstallmentLoanFor(MOCK_ADDRESS, MOCK_PROGRAM_ID, [], [], []))
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'freeze()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.freeze(MOCK_LOAN_ID))
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'unfreeze()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.unfreeze(MOCK_LOAN_ID))
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'revokeLoan()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.revokeLoan(MOCK_LOAN_ID))
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'revokeInstallmentLoan()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.revokeInstallmentLoan(MOCK_LOAN_ID))
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'updateLoanDuration()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.updateLoanDuration(MOCK_LOAN_ID, 0))
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'updateLoanInterestRatePrimary()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.updateLoanInterestRatePrimary(MOCK_LOAN_ID, 0))
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'updateLoanInterestRateSecondary()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.updateLoanInterestRateSecondary(MOCK_LOAN_ID, 0))
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'configureAlias()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.configureAlias(MOCK_ADDRESS, true))
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'getCreditLineLender()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.getCreditLineLender(MOCK_ADDRESS))
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'getLiquidityPoolLender()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.getLiquidityPoolLender(MOCK_ADDRESS))
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'getProgramLender()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.getProgramLender(MOCK_PROGRAM_ID))
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'getProgramCreditLine()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.getProgramCreditLine(MOCK_PROGRAM_ID))
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'getProgramLiquidityPool()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.getProgramLiquidityPool(MOCK_PROGRAM_ID))
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'getLoanStateBatch()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.getLoanStateBatch([MOCK_LOAN_ID]))
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'getLoanPreview()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.getLoanPreview(MOCK_LOAN_ID, 0))
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'getLoanPreviewBatch()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.getLoanPreviewBatch([MOCK_LOAN_ID], 0))
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'getInstallmentLoanPreview()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.getInstallmentLoanPreview(MOCK_LOAN_ID, MOCK_ADDRESS))
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'isLenderOrAlias()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.isLenderOrAlias(MOCK_LOAN_ID, MOCK_ADDRESS))
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'isProgramLenderOrAlias()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.isProgramLenderOrAlias(MOCK_PROGRAM_ID, MOCK_ADDRESS))
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'hasAlias()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.hasAlias(MOCK_ADDRESS, MOCK_ADDRESS))
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'interestRateFactor()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.interestRateFactor())
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'periodInSeconds()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.periodInSeconds())
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'timeOffset()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.timeOffset())
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'loanCounter()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.loanCounter())
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });

    it("Function 'programCounter()'", async () => {
      const { lendingMarket } = await setUpFixture(deployLendingMarketMock);

      await expect(lendingMarket.programCounter())
        .to.be.revertedWithCustomError(lendingMarket, ERROR_NAME_NOT_IMPLEMENTED);
    });
  });
});
