// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";

import { Loan } from "src/common/libraries/Loan.sol";
import { Error } from "src/common/libraries/Error.sol";
import { Interest } from "src/common/libraries/Interest.sol";

contract LoanComplexScenarios is Test {
    // -------------------------------------------- //
    //  Constants                                   //
    // -------------------------------------------- //

    uint32 private constant INTEREST_RATE_FACTOR = 1_000_000_000;

    uint32 private constant INTEREST_RATE_365 = 4_219_472; // 365 %
    uint32 private constant INTEREST_RATE_730 = 5_814_801; // 730 %

    uint32 private constant INTEREST_RATE_10 = 261_157; // 10 %
    uint32 private constant INTEREST_RATE_20 = 499_635; // 20 %

    uint64 private constant BORROW_AMOUNT_1B = 1_000_000_000_000;
    uint64 private constant BORROW_AMOUNT_1M = 1_000_000;

    uint32 private constant DURATION_IN_PERIODS = 750;
    uint32 private constant ITERATION_STEP = 50;

    uint256 private constant PRECISION_FACTOR = 1_000_000_000;
    uint256 private constant PRECISION_MINIMUM = 10_000; // 0.001%

    // -------------------------------------------- //
    //  Structs                                     //
    // -------------------------------------------- //

    struct Scenario {
        uint64 borrowAmount;
        uint32 durationInPeriods;
        uint32 interestRatePrimary;
        uint32 interestRateSecondary;
        Interest.Formula interestFormula;
        uint32 interestRateFactor;
        uint32 iterationStep;
        uint256 precisionFactor;
        uint256 precisionMinimum;
        uint64[] repaymentAmounts;
        uint64[] outstandingBalancesBeforeRepayment;
    }

    // -------------------------------------------- //
    //  Initialization                              //
    // -------------------------------------------- //

    function initScenario(
        uint64 borrowAmount,
        uint32 interestRatePrimary,
        uint32 interestRateSecondary,
        uint64[] memory repaymentAmounts,
        uint64[] memory outstandingBalancesBeforeRepayment
    ) private pure returns (Scenario memory) {
        return Scenario({
            borrowAmount: borrowAmount,
            durationInPeriods: DURATION_IN_PERIODS,
            interestRatePrimary: interestRatePrimary,
            interestRateSecondary: interestRateSecondary,
            interestFormula: Interest.Formula.Compound,
            interestRateFactor: INTEREST_RATE_FACTOR,
            iterationStep: ITERATION_STEP,
            precisionFactor: PRECISION_FACTOR,
            precisionMinimum: PRECISION_MINIMUM,
            repaymentAmounts: repaymentAmounts,
            outstandingBalancesBeforeRepayment: outstandingBalancesBeforeRepayment
        });
    }

    // -------------------------------------------- //
    //  Loan 10% | 20%, 1M                          //
    // -------------------------------------------- //

    uint64[] private SCENARIO_01_LOAN_10_20_1M_REPAYMENTS =
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    uint64[] private SCENARIO_01_LOAN_10_20_1M_OUTSTANDING_BALANCES = [
        1_013_142,
        1_026_457,
        1_039_946,
        1_053_613,
        1_067_459,
        1_081_487,
        1_095_700,
        1_110_099,
        1_124_688,
        1_139_468,
        1_154_443,
        1_169_614,
        1_184_985,
        1_200_558,
        1_216_335,
        1_247_096,
        1_278_635,
        1_310_972,
        1_344_127,
        1_378_120,
        1_412_973,
        1_448_707,
        1_485_345,
        1_522_909,
        1_561_423,
        1_600_911,
        1_641_398,
        1_682_909,
        1_725_470,
        1_769_107
    ];

    function SCENARIO_01_LOAN_10_20_1M() public view returns (Scenario memory) {
        return initScenario(
            BORROW_AMOUNT_1M,
            INTEREST_RATE_10,
            INTEREST_RATE_20,
            SCENARIO_01_LOAN_10_20_1M_REPAYMENTS,
            SCENARIO_01_LOAN_10_20_1M_OUTSTANDING_BALANCES
        );
    }

    uint64[] private SCENARIO_02_LOAN_10_20_1M_REPAYMENTS = [
        10_000,
        10_000,
        10_000,
        10_000,
        10_000,
        10_000,
        10_000,
        10_000,
        10_000,
        10_000,
        10_000,
        10_000,
        10_000,
        10_000,
        10_000,
        10_000,
        10_000,
        10_000,
        10_000,
        10_000,
        10_000,
        10_000,
        10_000,
        10_000,
        10_000,
        10_000,
        10_000,
        10_000,
        10_000,
        10_000
    ];

    uint64[] private SCENARIO_02_LOAN_10_20_1M_OUTSTANDING_BALANCES = [
        1_013_142,
        1_016_325,
        1_019_550,
        1_022_817,
        1_026_127,
        1_029_481,
        1_032_879,
        1_036_321,
        1_039_809,
        1_043_343,
        1_046_923,
        1_050_550,
        1_054_225,
        1_057_948,
        1_061_720,
        1_078_318,
        1_095_336,
        1_112_784,
        1_130_673,
        1_149_015,
        1_167_821,
        1_187_102,
        1_206_871,
        1_227_140,
        1_247_922,
        1_269_229,
        1_291_075,
        1_313_473,
        1_336_438,
        1_359_984
    ];

    function SCENARIO_02_LOAN_10_20_1M() public view returns (Scenario memory) {
        return initScenario(
            BORROW_AMOUNT_1M,
            INTEREST_RATE_10,
            INTEREST_RATE_20,
            SCENARIO_02_LOAN_10_20_1M_REPAYMENTS,
            SCENARIO_02_LOAN_10_20_1M_OUTSTANDING_BALANCES
        );
    }

    uint64[] private SCENARIO_03_LOAN_10_20_1M_REPAYMENTS = [
        40_000,
        40_000,
        40_000,
        40_000,
        40_000,
        40_000,
        40_000,
        40_000,
        40_000,
        40_000,
        40_000,
        40_000,
        40_000,
        40_000,
        40_000,
        40_000,
        40_000,
        40_000,
        40_000,
        40_000,
        40_000,
        40_000,
        40_000,
        40_000,
        40_000,
        40_000,
        40_000,
        40_000,
        40_000,
        40_000
    ];

    uint64[] private SCENARIO_03_LOAN_10_20_1M_OUTSTANDING_BALANCES = [
        1_013_142,
        985_931,
        958_362,
        930_431,
        902_133,
        873_463,
        844_416,
        814_987,
        785_172,
        754_965,
        724_361,
        693_355,
        661_941,
        630_114,
        597_869,
        571_978,
        545_432,
        518_214,
        490_308,
        461_696,
        432_361,
        402_284,
        371_446,
        339_828,
        307_411,
        274_174,
        240_096,
        205_156,
        169_333,
        132_604
    ];

    function SCENARIO_03_LOAN_10_20_1M() public view returns (Scenario memory) {
        return initScenario(
            BORROW_AMOUNT_1M,
            INTEREST_RATE_10,
            INTEREST_RATE_20,
            SCENARIO_03_LOAN_10_20_1M_REPAYMENTS,
            SCENARIO_03_LOAN_10_20_1M_OUTSTANDING_BALANCES
        );
    }

    // -------------------------------------------- //
    //  Loan 10% | 20%, 1B                          //
    // -------------------------------------------- //

    uint64[] private SCENARIO_04_LOAN_10_20_1B_REPAYMENTS =
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    uint64[] private SCENARIO_04_LOAN_10_20_1B_OUTSTANDING_BALANCES = [
        1_013_141_793_199,
        1_026_456_293_127,
        1_039_945_769_459,
        1_053_612_521_700,
        1_067_458_879_572,
        1_081_487_203_416,
        1_095_699_884_591,
        1_110_099_345_883,
        1_124_688_041_917,
        1_139_468_459_577,
        1_154_443_118_430,
        1_169_614_571_153,
        1_184_985_403_970,
        1_200_558_237_093,
        1_216_335_725_168,
        1_247_096_925_896,
        1_278_636_079_167,
        1_310_972_859_446,
        1_344_127_438_765,
        1_378_120_499_310,
        1_412_973_246_319,
        1_448_707_421_312,
        1_485_345_315_654,
        1_522_909_784_460,
        1_561_424_260_851,
        1_600_912_770_574,
        1_641_399_946_988,
        1_682_911_046_432,
        1_725_471_963_978,
        1_769_109_249_586
    ];

    function SCENARIO_04_LOAN_10_20_1B() public view returns (Scenario memory) {
        return initScenario(
            BORROW_AMOUNT_1B,
            INTEREST_RATE_10,
            INTEREST_RATE_20,
            SCENARIO_04_LOAN_10_20_1B_REPAYMENTS,
            SCENARIO_04_LOAN_10_20_1B_OUTSTANDING_BALANCES
        );
    }

    uint64[] private SCENARIO_05_LOAN_10_20_1B_REPAYMENTS = [
        10_000_000_000,
        10_000_000_000,
        10_000_000_000,
        10_000_000_000,
        10_000_000_000,
        10_000_000_000,
        10_000_000_000,
        10_000_000_000,
        10_000_000_000,
        10_000_000_000,
        10_000_000_000,
        10_000_000_000,
        10_000_000_000,
        10_000_000_000,
        10_000_000_000,
        10_000_000_000,
        10_000_000_000,
        10_000_000_000,
        10_000_000_000,
        10_000_000_000,
        10_000_000_000,
        10_000_000_000,
        10_000_000_000,
        10_000_000_000,
        10_000_000_000,
        10_000_000_000,
        10_000_000_000,
        10_000_000_000,
        10_000_000_000,
        10_000_000_000
    ];

    uint64[] private SCENARIO_05_LOAN_10_20_1B_OUTSTANDING_BALANCES = [
        1_013_141_793_199,
        1_016_324_875_195,
        1_019_549_788_596,
        1_022_817_083_142,
        1_026_127_315_797,
        1_029_481_050_845,
        1_032_878_859_986,
        1_036_321_322_432,
        1_039_809_025_007,
        1_043_342_562_248,
        1_046_922_536_505,
        1_050_549_558_043,
        1_054_224_245_148,
        1_057_947_224_231,
        1_061_719_129_936,
        1_078_317_167_465,
        1_095_334_970_321,
        1_112_783_154_394,
        1_130_672_604_050,
        1_149_014_478_921,
        1_167_820_220_867,
        1_187_101_561_112,
        1_206_870_527_566,
        1_227_139_452_323,
        1_247_920_979_357,
        1_269_228_072_410,
        1_291_074_023_077,
        1_313_472_459_098,
        1_336_437_352_859,
        1_359_983_030_110
    ];

    function SCENARIO_05_LOAN_10_20_1B() public view returns (Scenario memory) {
        return initScenario(
            BORROW_AMOUNT_1B,
            INTEREST_RATE_10,
            INTEREST_RATE_20,
            SCENARIO_05_LOAN_10_20_1B_REPAYMENTS,
            SCENARIO_05_LOAN_10_20_1B_OUTSTANDING_BALANCES
        );
    }

    uint64[] private SCENARIO_06_LOAN_10_20_1B_REPAYMENTS = [
        40_000_000_000,
        40_000_000_000,
        40_000_000_000,
        40_000_000_000,
        40_000_000_000,
        40_000_000_000,
        40_000_000_000,
        40_000_000_000,
        40_000_000_000,
        40_000_000_000,
        40_000_000_000,
        40_000_000_000,
        40_000_000_000,
        40_000_000_000,
        40_000_000_000,
        40_000_000_000,
        40_000_000_000,
        40_000_000_000,
        40_000_000_000,
        40_000_000_000,
        40_000_000_000,
        40_000_000_000,
        40_000_000_000,
        40_000_000_000,
        40_000_000_000,
        40_000_000_000,
        40_000_000_000,
        40_000_000_000,
        40_000_000_000,
        40_000_000_000
    ];

    uint64[] private SCENARIO_06_LOAN_10_20_1B_OUTSTANDING_BALANCES = [
        1_013_141_793_199,
        985_930_621_399,
        958_361_846_006,
        930_430_767_468,
        902_132_624_472,
        873_462_593_133,
        844_415_786_171,
        814_987_252_079,
        785_171_974_278,
        754_964_870_262,
        724_360_790_732,
        693_354_518_717,
        661_940_768_688,
        630_114_185_652,
        597_869_344_244,
        571_977_892_175,
        545_431_643_788,
        518_214_039_246,
        490_308_099_914,
        461_696_417_764,
        432_361_144_521,
        402_283_980_523,
        371_446_163_311,
        339_828_455_921,
        307_411_134_885,
        274_173_977_928,
        240_096_251_352,
        205_156_697_103,
        169_333_519_510,
        132_604_371_687
    ];

    function SCENARIO_06_LOAN_10_20_1B() public view returns (Scenario memory) {
        return initScenario(
            BORROW_AMOUNT_1B,
            INTEREST_RATE_10,
            INTEREST_RATE_20,
            SCENARIO_06_LOAN_10_20_1B_REPAYMENTS,
            SCENARIO_06_LOAN_10_20_1B_OUTSTANDING_BALANCES
        );
    }

    // -------------------------------------------- //
    //  Loan 365% | 730%, 1M                        //
    // -------------------------------------------- //

    uint64[] private SCENARIO_07_LOAN_365_730_1M_REPAYMENTS =
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    uint64[] private SCENARIO_07_LOAN_365_730_1M_OUTSTANDING_BALANCES = [
        1_234_332,
        1_523_575,
        1_880_597,
        2_321_281,
        2_865_231,
        3_536_646,
        4_365_395,
        5_388_346,
        6_651_007,
        8_209_549,
        10_133_307,
        12_507_863,
        15_438_853,
        19_056_667,
        23_522_250,
        31_432_576,
        42_003_075,
        56_128_340,
        75_003_807,
        100_226_927,
        133_932_361,
        178_972_635,
        239_159_557,
        319_586_812,
        427_061_045,
        570_677_916,
        762_591_877,
        1_019_044_815,
        1_361_740_619,
        1_819_682_006
    ];

    function SCENARIO_07_LOAN_365_730_1M() public view returns (Scenario memory) {
        return initScenario(
            BORROW_AMOUNT_1M,
            INTEREST_RATE_365,
            INTEREST_RATE_730,
            SCENARIO_07_LOAN_365_730_1M_REPAYMENTS,
            SCENARIO_07_LOAN_365_730_1M_OUTSTANDING_BALANCES
        );
    }

    uint64[] private SCENARIO_08_LOAN_365_730_1M_REPAYMENTS = [
        50_000,
        150_000,
        150_000,
        150_000,
        150_000,
        150_000,
        150_000,
        150_000,
        150_000,
        150_000,
        150_000,
        1_500_000,
        1_500_000,
        1_500_000,
        1_500_000,
        1_500_000,
        1_500_000,
        1_500_000,
        1_500_000,
        150_000,
        150_000,
        150_000,
        150_000,
        150_000,
        150_000,
        150_000,
        150_000,
        150_000,
        150_000,
        150_000
    ];

    uint64[] private SCENARIO_08_LOAN_365_730_1M_OUTSTANDING_BALANCES = [
        1_234_332,
        1_461_859,
        1_619_269,
        1_813_565,
        2_053_391,
        2_349_416,
        2_714_809,
        3_165_825,
        3_722_529,
        4_409_686,
        5_257_866,
        6_304_801,
        5_930_719,
        5_468_977,
        4_899_034,
        4_542_099,
        4_065_130,
        3_427_761,
        2_576_050,
        1_437_916,
        1_721_031,
        2_099_355,
        2_604_906,
        3_280_469,
        4_183_218,
        5_389_554,
        7_001_570,
        9_155_693,
        12_034_228,
        15_880_789
    ];

    function SCENARIO_08_LOAN_365_730_1M() public view returns (Scenario memory) {
        return initScenario(
            BORROW_AMOUNT_1M,
            INTEREST_RATE_365,
            INTEREST_RATE_730,
            SCENARIO_08_LOAN_365_730_1M_REPAYMENTS,
            SCENARIO_08_LOAN_365_730_1M_OUTSTANDING_BALANCES
        );
    }

    // -------------------------------------------- //
    //  Loan 365% | 730%, 1B                        //
    // -------------------------------------------- //

    uint64[] private SCENARIO_09_LOAN_365_730_1B_REPAYMENTS =
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    uint64[] private SCENARIO_09_LOAN_365_730_1B_OUTSTANDING_BALANCES = [
        1_234_331_781_587,
        1_523_574_947_036,
        1_880_596_978_757,
        2_321_280_619_237,
        2_865_230_442_307,
        3_536_644_996_511,
        4_365_393_319_385,
        5_388_343_713_246,
        6_651_003_895_376,
        8_209_545_487_524,
        10_133_302_907_638,
        12_507_857_831_349,
        15_438_846_440_811,
        19_056_658_832_940,
        23_522_239_648_366,
        31_432_561_855_543,
        42_003_055_813_231,
        56_128_313_872_650,
        75_003_771_920_670,
        100_226_880_413_543,
        133_932_298_339_015,
        178_972_551_718_242,
        239_159_445_972_175,
        319_586_663_142_423,
        427_060_845_718_765,
        570_677_650_164_485,
        762_591_522_173_226,
        1_019_044_340_571_000,
        1_361_739_985_110_800,
        1_819_681_159_320_820
    ];

    function SCENARIO_09_LOAN_365_730_1B() public view returns (Scenario memory) {
        return initScenario(
            BORROW_AMOUNT_1B,
            INTEREST_RATE_365,
            INTEREST_RATE_730,
            SCENARIO_09_LOAN_365_730_1B_REPAYMENTS,
            SCENARIO_09_LOAN_365_730_1B_OUTSTANDING_BALANCES
        );
    }

    uint64[] private SCENARIO_10_LOAN_365_730_1B_REPAYMENTS = [
        50_000_000_000,
        150_000_000_000,
        150_000_000_000,
        150_000_000_000,
        150_000_000_000,
        150_000_000_000,
        150_000_000_000,
        150_000_000_000,
        150_000_000_000,
        150_000_000_000,
        150_000_000_000,
        1_500_000_000_000,
        1_500_000_000_000,
        1_500_000_000_000,
        1_500_000_000_000,
        1_500_000_000_000,
        1_500_000_000_000,
        1_500_000_000_000,
        1_500_000_000_000,
        150_000_000_000,
        150_000_000_000,
        150_000_000_000,
        150_000_000_000,
        150_000_000_000,
        150_000_000_000,
        150_000_000_000,
        150_000_000_000,
        150_000_000_000,
        150_000_000_000,
        150_000_000_000
    ];

    uint64[] private SCENARIO_10_LOAN_365_730_1B_OUTSTANDING_BALANCES = [
        1_234_331_781_587,
        1_461_858_357_957,
        1_619_268_464_167,
        1_813_564_761_005,
        2_053_390_855_237,
        2_349_415_825_402,
        2_714_808_854_220,
        3_165_825_082_460,
        3_722_528_746_989,
        4_409_685_773_043,
        5_257_865_529_243,
        6_304_800_758_819,
        5_930_718_280_805,
        5_468_976_389_258,
        4_899_033_697_631,
        4_542_098_819_969,
        4_065_129_883_837,
        3_427_760_491_625,
        2_576_049_381_415,
        1_437_915_319_568,
        1_721_029_908_384,
        2_099_353_442_121,
        2_604_903_851_153,
        3_280_466_414_096,
        4_183_214_722_268,
        5_389_549_342_644,
        7_001_563_680_577,
        9_155_684_255_257,
        12_034_216_623_778,
        15_880_774_097_866
    ];

    function SCENARIO_10_LOAN_365_730_1B() public view returns (Scenario memory) {
        return initScenario(
            BORROW_AMOUNT_1B,
            INTEREST_RATE_365,
            INTEREST_RATE_730,
            SCENARIO_10_LOAN_365_730_1B_REPAYMENTS,
            SCENARIO_10_LOAN_365_730_1B_OUTSTANDING_BALANCES
        );
    }
}
