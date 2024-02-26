// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import {Loan} from "../libraries/Loan.sol";
import {Error} from "../libraries/Error.sol";
import {ILendingMarket} from "../interfaces/core/ILendingMarket.sol";

/// @title LendingMarketMock contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @notice Mock of the `LendingMarket` contract used for testing
contract LendingMarketMock is ILendingMarket {
    // -------------------------------------------- //
    //  Events                                      //
    // -------------------------------------------- //

    event RegisterCreditLineCalled(address indexed lender, address indexed creditLine);

    event RegisterLiquidityPoolCalled(address indexed lender, address indexed liquidityPool);
    event RepayLoanCalled(
        uint256 indexed loanId,
        uint256 repayAmount
    );

    // -------------------------------------------- //
    //  Storage variables                           //
    // -------------------------------------------- //

    mapping(uint256 => Loan.State) _loanState;

    // -------------------------------------------- //
    //  ILendingMarket functions                    //
    // -------------------------------------------- //

    function takeLoan(address creditLine, uint256 amount) external returns (uint256) {
        revert Error.NotImplemented();
    }

    function repayLoan(uint256 loanId, uint256 amount) external {
        emit RepayLoanCalled(loanId, amount);
    }

    function freeze(uint256 loanId) external {
        revert Error.NotImplemented();
    }

    function unfreeze(uint256 loanId) external {
        revert Error.NotImplemented();
    }

    function updateLoanDuration(uint256 loanId, uint256 newDurationInPeriods) external {
        revert Error.NotImplemented();
    }

    function updateLoanMoratorium(uint256 loanId, uint256 newMoratoriumInPeriods) external {
        revert Error.NotImplemented();
    }

    function updateLoanInterestRatePrimary(uint256 loanId, uint256 newInterestRate) external {
        revert Error.NotImplemented();
    }

    function updateLoanInterestRateSecondary(uint256 loanId, uint256 newInterestRate) external {
        revert Error.NotImplemented();
    }

    function registerCreditLine(address lender, address creditLine) external {
        emit RegisterCreditLineCalled(lender, creditLine);
    }

    function registerLiquidityPool(address lender, address liquidityPool) external {
        emit RegisterLiquidityPoolCalled(lender, liquidityPool);
    }

    function updateCreditLineLender(address creditLine, address newLender) external {
        revert Error.NotImplemented();
    }

    function updateLiquidityPoolLender(address liquidityPool, address newLender) external {
        revert Error.NotImplemented();
    }

    function assignLiquidityPoolToCreditLine(address creditLine, address liquidityPool) external {
        revert Error.NotImplemented();
    }

    function configureAlias(address account, bool isAlias) external {
        revert Error.NotImplemented();
    }

    function getCreditLineLender(address creditLine) external pure returns (address) {
        revert Error.NotImplemented();
    }

    function getLiquidityPoolLender(address lender) external pure returns (address) {
        revert Error.NotImplemented();
    }

    function getLiquidityPoolByCreditLine(address creditLine) external pure returns (address) {
        revert Error.NotImplemented();
    }

    function getLoanStored(uint256 loanId) external view returns (Loan.State memory) {
        return _loanState[loanId];
    }

    function getLoanCurrent(uint256 loanId) external view returns (Loan.State memory) {
        revert Error.NotImplemented();
    }

    function getLoanBalance(uint256 loanId, uint256 timestamp) external pure returns (uint256, uint256) {
        revert Error.NotImplemented();
    }

    function hasAlias(address lender, address account) external pure returns (bool) {
        revert Error.NotImplemented();
    }

    function registry() external pure returns (address) {
        revert Error.NotImplemented();
    }

    // -------------------------------------------- //
    //  Mock functions                              //
    // -------------------------------------------- //

    function mockLoanState(uint256 loanId, Loan.State memory state) external {
        _loanState[loanId] = state;
    }
}
