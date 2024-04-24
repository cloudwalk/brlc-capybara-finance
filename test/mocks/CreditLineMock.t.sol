// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";

import { Loan } from "src/common/libraries/Loan.sol";
import { Error } from "src/common/libraries/Error.sol";
import { Interest } from "src/common/libraries/Interest.sol";

import { CreditLineMock } from "src/mocks/CreditLineMock.sol";

/// @title CreditLineMockTest contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Contains tests for the `CreditLineMock` contract.
contract CreditLineMockTest is Test {
    // -------------------------------------------- //
    //  Storage variables                           //
    // -------------------------------------------- //

    CreditLineMock private mock;

    uint256 private constant LOAN_ID = 1;
    uint256 private constant BORROW_AMOUNT = 100;
    uint256 private constant DURATION_IN_PERIODS = 30;
    address private constant BORROWER = address(bytes20(keccak256("borrower")));

    address private constant TERMS_TOKEN = address(bytes20(keccak256("token")));
    address private constant TERMS_TREASURY = address(bytes20(keccak256("treasury")));
    address private constant TERMS_ADDON_RECIPIENT = address(bytes20(keccak256("addon")));

    uint16 private constant TERMS_REVOKE_PERIODS = 50;
    uint32 private constant TERMS_PERIOD_IN_SECONDS = 100;
    uint32 private constant TERMS_DURATION_IN_PERIODS = 200;
    uint32 private constant TERMS_INTEREST_RATE_FACTOR = 300;
    uint32 private constant TERMS_INTEREST_RATE_PRIMARY = 400;
    uint32 private constant TERMS_INTEREST_RATE_SECONDARY = 500;
    uint32 private constant TERMS_ADDON_AMOUNT = 600;

    Interest.Formula private constant TERMS_INTEREST_FORMULA = Interest.Formula.Compound;
    bool private constant TERMS_AUTO_REPAYMENT = true;

    // -------------------------------------------- //
    //  Setup and configuration                     //
    // -------------------------------------------- //

    function setUp() public {
        mock = new CreditLineMock();
    }

    // -------------------------------------------- //
    //  ICreditLineFactory functions                //
    // -------------------------------------------- //

    function test_onBeforeLoanTaken() public {
        Loan.Terms memory terms = mock.onBeforeLoanTaken(BORROWER, BORROW_AMOUNT, DURATION_IN_PERIODS, LOAN_ID);

        assertEq(terms.token, address(0));
        assertEq(terms.treasury, address(0));
        assertEq(terms.periodInSeconds, 0);
        assertEq(terms.durationInPeriods, 0);
        assertEq(terms.interestRateFactor, 0);
        assertEq(terms.interestRatePrimary, 0);
        assertEq(terms.interestRateSecondary, 0);
        assertEq(uint256(terms.interestFormula), uint256(Interest.Formula.Simple));
        assertEq(terms.addonRecipient, address(0));
        assertEq(terms.autoRepayment, false);
        assertEq(terms.revokePeriods, 0);
        assertEq(terms.addonAmount, 0);

        mock.mockLoanTerms(
            BORROWER,
            BORROW_AMOUNT,
            Loan.Terms({
                token: TERMS_TOKEN,
                treasury: TERMS_TREASURY,
                periodInSeconds: TERMS_PERIOD_IN_SECONDS,
                durationInPeriods: TERMS_DURATION_IN_PERIODS,
                interestRateFactor: TERMS_INTEREST_RATE_FACTOR,
                interestRatePrimary: TERMS_INTEREST_RATE_PRIMARY,
                interestRateSecondary: TERMS_INTEREST_RATE_SECONDARY,
                interestFormula: TERMS_INTEREST_FORMULA,
                addonRecipient: TERMS_ADDON_RECIPIENT,
                autoRepayment: TERMS_AUTO_REPAYMENT,
                revokePeriods: TERMS_REVOKE_PERIODS,
                addonAmount: TERMS_ADDON_AMOUNT
            })
        );

        terms = mock.onBeforeLoanTaken(BORROWER, BORROW_AMOUNT, DURATION_IN_PERIODS, LOAN_ID);

        assertEq(terms.token, TERMS_TOKEN);
        assertEq(terms.treasury, TERMS_TREASURY);
        assertEq(terms.periodInSeconds, TERMS_PERIOD_IN_SECONDS);
        assertEq(terms.durationInPeriods, TERMS_DURATION_IN_PERIODS);
        assertEq(terms.interestRateFactor, TERMS_INTEREST_RATE_FACTOR);
        assertEq(terms.interestRatePrimary, TERMS_INTEREST_RATE_PRIMARY);
        assertEq(terms.interestRateSecondary, TERMS_INTEREST_RATE_SECONDARY);
        assertEq(uint256(terms.interestFormula), uint256(TERMS_INTEREST_FORMULA));
        assertEq(terms.addonRecipient, TERMS_ADDON_RECIPIENT);
        assertEq(terms.autoRepayment, TERMS_AUTO_REPAYMENT);
        assertEq(terms.revokePeriods, TERMS_REVOKE_PERIODS);
        assertEq(terms.addonAmount, TERMS_ADDON_AMOUNT);
    }

    function test_determineLoanTerms() public {
        Loan.Terms memory terms = mock.determineLoanTerms(BORROWER, BORROW_AMOUNT, DURATION_IN_PERIODS);

        assertEq(terms.token, address(0));
        assertEq(terms.treasury, address(0));
        assertEq(terms.periodInSeconds, 0);
        assertEq(terms.durationInPeriods, 0);
        assertEq(terms.interestRateFactor, 0);
        assertEq(terms.interestRatePrimary, 0);
        assertEq(terms.interestRateSecondary, 0);
        assertEq(uint256(terms.interestFormula), uint256(Interest.Formula.Simple));
        assertEq(terms.addonRecipient, address(0));
        assertEq(terms.autoRepayment, false);
        assertEq(terms.revokePeriods, 0);
        assertEq(terms.addonAmount, 0);

        mock.mockLoanTerms(
            BORROWER,
            BORROW_AMOUNT,
            Loan.Terms({
                token: TERMS_TOKEN,
                treasury: TERMS_TREASURY,
                periodInSeconds: TERMS_PERIOD_IN_SECONDS,
                durationInPeriods: TERMS_DURATION_IN_PERIODS,
                interestRateFactor: TERMS_INTEREST_RATE_FACTOR,
                interestRatePrimary: TERMS_INTEREST_RATE_PRIMARY,
                interestRateSecondary: TERMS_INTEREST_RATE_SECONDARY,
                interestFormula: TERMS_INTEREST_FORMULA,
                addonRecipient: TERMS_ADDON_RECIPIENT,
                autoRepayment: TERMS_AUTO_REPAYMENT,
                revokePeriods: TERMS_REVOKE_PERIODS,
                addonAmount: TERMS_ADDON_AMOUNT
            })
        );

        terms = mock.determineLoanTerms(BORROWER, BORROW_AMOUNT, DURATION_IN_PERIODS);

        assertEq(terms.token, TERMS_TOKEN);
        assertEq(terms.treasury, TERMS_TREASURY);
        assertEq(terms.periodInSeconds, TERMS_PERIOD_IN_SECONDS);
        assertEq(terms.durationInPeriods, TERMS_DURATION_IN_PERIODS);
        assertEq(terms.interestRateFactor, TERMS_INTEREST_RATE_FACTOR);
        assertEq(terms.interestRatePrimary, TERMS_INTEREST_RATE_PRIMARY);
        assertEq(terms.interestRateSecondary, TERMS_INTEREST_RATE_SECONDARY);
        assertEq(uint256(terms.interestFormula), uint256(TERMS_INTEREST_FORMULA));
        assertEq(terms.addonRecipient, TERMS_ADDON_RECIPIENT);
        assertEq(terms.autoRepayment, TERMS_AUTO_REPAYMENT);
        assertEq(terms.revokePeriods, TERMS_REVOKE_PERIODS);
        assertEq(terms.addonAmount, TERMS_ADDON_AMOUNT);
    }

    function test_market() public {
        vm.expectRevert(Error.NotImplemented.selector);
        mock.market();
    }

    function test_lender() public {
        vm.expectRevert(Error.NotImplemented.selector);
        mock.lender();
    }

    function test_token() public {
        assertEq(mock.token(), address(0));
        mock.mockTokenAddress(TERMS_TOKEN);
        assertEq(mock.token(), TERMS_TOKEN);
    }

    function test_kind() public {
        vm.expectRevert(Error.NotImplemented.selector);
        mock.kind();
    }
}
