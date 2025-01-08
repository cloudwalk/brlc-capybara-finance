// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { Loan } from "../common/libraries/Loan.sol";
import { Error } from "../common/libraries/Error.sol";
import { ILendingMarket } from "../common/interfaces/core/ILendingMarket.sol";
import { ILiquidityPool } from "../common/interfaces/core/ILiquidityPool.sol";
import { ICreditLine } from "../common/interfaces/core/ICreditLine.sol";

/// @title LendingMarketMock contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Mock of the `LendingMarket` contract used for testing.
contract LendingMarketMock is ILendingMarket {
    // -------------------------------------------- //
    //  Events                                      //
    // -------------------------------------------- //

    event RepayLoanCalled(uint256 indexed loanId, uint256 repayAmount, uint256 repaymentCounter);
    event HookCallResult(bool result);

    // -------------------------------------------- //
    //  Storage variables                           //
    // -------------------------------------------- //

    mapping(uint256 => Loan.State) private _loanStates;
    uint256 public repaymentCounter;

    // -------------------------------------------- //
    //  ILendingMarket functions                    //
    // -------------------------------------------- //

    function registerCreditLine(address creditLine) external pure {
        creditLine; // To prevent compiler warning about unused variable
        revert Error.NotImplemented();
    }

    function registerLiquidityPool(address liquidityPool) external pure {
        liquidityPool; // To prevent compiler warning about unused variable
        revert Error.NotImplemented();
    }

    function createProgram(address creditLine, address liquidityPool) external pure {
        creditLine; // To prevent compiler warning about unused variable
        liquidityPool; // To prevent compiler warning about unused variable
        revert Error.NotImplemented();
    }

    function updateProgram(uint32 programId, address creditLine, address liquidityPool) external pure {
        programId; // To prevent compiler warning about unused variable
        creditLine; // To prevent compiler warning about unused variable
        liquidityPool; // To prevent compiler warning about unused variable
        revert Error.NotImplemented();
    }

    function takeLoanFor(
        address borrower,
        uint32 programId,
        uint256 borrowAmount,
        uint256 addonAmount,
        uint256 durationInPeriods
    ) external pure returns (uint256) {
        borrower; // To prevent compiler warning about unused variable
        programId; // To prevent compiler warning about unused variable
        borrowAmount; // To prevent compiler warning about unused variable
        addonAmount; // To prevent compiler warning about unused variable
        durationInPeriods; // To prevent compiler warning about unused variable
        revert Error.NotImplemented();
    }

    function takeLoan(
        uint32 programId,
        uint256 borrowAmount,
        uint256 durationInPeriods
    ) external pure returns (uint256) {
        programId; // To prevent compiler warning about unused variable
        borrowAmount; // To prevent compiler warning about unused variable
        durationInPeriods; // To prevent compiler warning about unused variable
        revert Error.NotImplemented();
    }

    function repayLoan(uint256 loanId, uint256 repayAmount) external {
        loanId; // To prevent compiler warning about unused variable
        repayAmount; // To prevent compiler warning about unused variable
        ++repaymentCounter;
        emit RepayLoanCalled(loanId, repayAmount, repaymentCounter);
    }

    function freeze(uint256 loanId) external pure {
        loanId; // To prevent compiler warning about unused variable
        revert Error.NotImplemented();
    }

    function unfreeze(uint256 loanId) external pure {
        loanId; // To prevent compiler warning about unused variable
        revert Error.NotImplemented();
    }

    function revokeLoan(uint256 loanId) external pure {
        loanId; // To prevent compiler warning about unused variable
        revert Error.NotImplemented();
    }

    function updateLoanDuration(uint256 loanId, uint256 newDurationInPeriods) external pure {
        loanId; // To prevent compiler warning about unused variable
        newDurationInPeriods; // To prevent compiler warning about unused variable
        revert Error.NotImplemented();
    }

    function updateLoanInterestRatePrimary(uint256 loanId, uint256 newInterestRate) external pure {
        loanId; // To prevent compiler warning about unused variable
        newInterestRate; // To prevent compiler warning about unused variable
        revert Error.NotImplemented();
    }

    function updateLoanInterestRateSecondary(uint256 loanId, uint256 newInterestRate) external pure {
        loanId; // To prevent compiler warning about unused variable
        newInterestRate; // To prevent compiler warning about unused variable
        revert Error.NotImplemented();
    }

    function configureAlias(address account, bool isAlias) external pure {
        account; // To prevent compiler warning about unused variable
        isAlias; // To prevent compiler warning about unused variable
        revert Error.NotImplemented();
    }

    function getCreditLineLender(address creditLine) external pure returns (address) {
        creditLine; // To prevent compiler warning about unused variable
        revert Error.NotImplemented();
    }

    function getLiquidityPoolLender(address lender) external pure returns (address) {
        lender; // To prevent compiler warning about unused variable
        revert Error.NotImplemented();
    }

    function getProgramLender(uint32 programId) external pure returns (address) {
        programId; // To prevent compiler warning about unused variable
        revert Error.NotImplemented();
    }

    function getProgramCreditLine(uint32 programId) external pure returns (address) {
        programId; // To prevent compiler warning about unused variable
        revert Error.NotImplemented();
    }

    function getProgramLiquidityPool(uint32 programId) external pure returns (address) {
        programId; // To prevent compiler warning about unused variable
        revert Error.NotImplemented();
    }

    function getLoanState(uint256 loanId) external view returns (Loan.State memory) {
        return _loanStates[loanId];
    }

    function getLoanPreview(uint256 loanId, uint256 timestamp) external pure returns (Loan.Preview memory) {
        loanId; // To prevent compiler warning about unused variable
        timestamp; // To prevent compiler warning about unused variable
        revert Error.NotImplemented();
    }

    function isLenderOrAlias(uint256 loanId, address account) external pure returns (bool) {
        loanId; // To prevent compiler warning about unused variable
        account; // To prevent compiler warning about unused variable
        revert Error.NotImplemented();
    }

    function hasAlias(address lender, address account) external pure returns (bool) {
        lender; // To prevent compiler warning about unused variable
        account; // To prevent compiler warning about unused variable
        revert Error.NotImplemented();
    }

    function interestRateFactor() external pure returns (uint256) {
        revert Error.NotImplemented();
    }

    function periodInSeconds() external pure returns (uint256) {
        revert Error.NotImplemented();
    }

    function timeOffset() external pure returns (uint256, bool) {
        revert Error.NotImplemented();
    }

    function loanCounter() external pure returns (uint256) {
        revert Error.NotImplemented();
    }

    function programCounter() external pure returns (uint256) {
        revert Error.NotImplemented();
    }

    // -------------------------------------------- //
    //  Mock functions                              //
    // -------------------------------------------- //

    function mockLoanState(uint256 loanId, Loan.State memory state) external {
        _loanStates[loanId] = state;
    }

    function callOnBeforeLoanTakenLiquidityPool(address liquidityPool, uint256 loanId) external {
        emit HookCallResult(ILiquidityPool(liquidityPool).onBeforeLoanTaken(loanId));
    }

    function callOnBeforeLoanTakenCreditLine(address creditLine, uint256 loanId) external {
        emit HookCallResult(ICreditLine(creditLine).onBeforeLoanTaken(loanId));
    }

    function callOnAfterLoanPaymentLiquidityPool(address liquidityPool, uint256 loanId, uint256 amount) external {
        emit HookCallResult(ILiquidityPool(liquidityPool).onAfterLoanPayment(loanId, amount));
    }

    function callOnAfterLoanPaymentCreditLine(address creditLine, uint256 loanId, uint256 repayAmount) external {
        emit HookCallResult(ICreditLine(creditLine).onAfterLoanPayment(loanId, repayAmount));
    }

    function callOnAfterLoanRevocationLiquidityPool(address liquidityPool, uint256 loanId) external {
        emit HookCallResult(ILiquidityPool(liquidityPool).onAfterLoanRevocation(loanId));
    }

    function callOnAfterLoanRevocationCreditLine(address creditLine, uint256 loanId) external {
        emit HookCallResult(ICreditLine(creditLine).onAfterLoanRevocation(loanId));
    }

    function proveLendingMarket() external pure {}
}
