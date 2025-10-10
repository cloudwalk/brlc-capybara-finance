# LendingMarket.base.test

## Single-installment loan that is fully repaid at the due date

| Idx | Caller | Contract | Name | Args |
| --- | ------ | -------- | ---- | ---- |
| 1 | admin | LM | takeInstallmentLoan | [borrower, 1, [100000000], [20000], [10], [700000000]] |
| 2 | stranger | LM | repayLoan | [0, 1157920892..3129639935] |

```mermaid
sequenceDiagram
  actor admin
  actor stranger
  participant LM
  participant LP
  participant addonTreasury
  participant borrower
  rect rgb(230,255,230)
    admin->>LM: admin calls LM.takeInstallmentLoan
    Note over CL: CL.OnBeforeLoanTakenCalled
    Note over LM: LM.LoanTaken
    Note over LM: LM.LoanTakenDetailed
    Note over LM: LM.InstallmentLoanTaken
    Note over LP: LP.OnBeforeLiquidityOutCalled
    LP-->>borrower: BRLC.Transfer: LP -> borrower (100000000)
    Note over LP: LP.OnBeforeLiquidityOutCalled
    LP-->>addonTreasury: BRLC.Transfer: LP -> addonTreasury (20000)
    Note over LM: LM.LoanPenalizedBalanceUpdated
  end
  rect rgb(230,255,230)
    stranger->>LM: stranger calls LM.repayLoan
    Note over LP: LP.OnBeforeLiquidityInCalled
    stranger-->>LP: BRLC.Transfer: stranger -> LP (259430000)
    Note over CL: CL.OnAfterLoanPaymentCalled
    Note over LM: LM.LoanRepayment
  end
```

<details>
<summary>Step 0: LM.takeInstallmentLoan</summary>

- **type**: methodCall
- **caller**: admin
- **args**: `{
  "borrower": "borrower",
  "programId": "1",
  "borrowedAmounts": "[100000000]",
  "addonAmounts": "[20000]",
  "durationsInPeriods": "[10]",
  "penalizedBalances": "[700000000]"
}`

**Events**

| # | Contract | Event | Args |
| - | -------- | ----- | ---- |
| 1 | CL | OnBeforeLoanTakenCalled | `[0]` |
| 2 | LM | LoanTaken | `[0, borrower, 100020000, 10]` |
| 3 | LM | LoanTakenDetailed | `[0, borrower, 1, CL, LP, 100000000, 20000, 10, 100000000, 200000000]` |
| 4 | LM | InstallmentLoanTaken | `[0, borrower, 1, 1, 100000000, 20000]` |
| 5 | LP | OnBeforeLiquidityOutCalled | `[100000000]` |
| 6 | BRLC | Transfer | `[LP, borrower, 100000000]` |
| 7 | LP | OnBeforeLiquidityOutCalled | `[20000]` |
| 8 | BRLC | Transfer | `[LP, addonTreasury, 20000]` |
| 9 | LM | LoanPenalizedBalanceUpdated | `[0, 700000000, 0]` |

**Balances**

**Token:** BRLC
| Holder | Balance |
| ------ | ------- |
| LM | 0 |
| LP | 1299899280000 |
| CL | 0 |
| BRLC | 0 |
| deployer | 0 |
| owner | 2000000000000 |
| borrower | 2700100000000 |
| stranger | 2000000000000 |
| admin | 0 |
| addonTreasury | 2000000720000 |


**extendedLoanPreviewWithoutTimestamps**
```
Object {
  "addonAmount": 20000n,
  "borrowedAmount": 100000000n,
  "borrower": "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "discountAmount": 0n,
  "durationInPeriods": 10n,
  "firstInstallmentId": 0n,
  "installmentCount": 1n,
  "interestRatePrimary": 100000000n,
  "interestRateSecondary": 200000000n,
  "lateFeeAmount": 0n,
  "outstandingBalance": 100020000n,
  "penalizedBalance": 700000000n,
  "programId": 1n,
  "repaidAmount": 0n,
  "trackedBalance": 100020000n,
}
```

</details>
<details>
<summary>Step 1: LM.repayLoan</summary>

- **type**: methodCall
- **caller**: stranger
- **args**: `{
  "loanId": "0",
  "repaymentAmount": "1157920892..3129639935"
}`

**Events**

| # | Contract | Event | Args |
| - | -------- | ----- | ---- |
| 1 | LP | OnBeforeLiquidityInCalled | `[259430000]` |
| 2 | BRLC | Transfer | `[stranger, LP, 259430000]` |
| 3 | CL | OnAfterLoanPaymentCalled | `[0, 259430000]` |
| 4 | LM | LoanRepayment | `[0, stranger, borrower, 259430000, 0]` |

**Balances**

**Token:** BRLC
| Holder | Balance |
| ------ | ------- |
| LM | 0 |
| LP | 1300158710000 |
| CL | 0 |
| BRLC | 0 |
| deployer | 0 |
| owner | 2000000000000 |
| borrower | 2700100000000 |
| stranger | 1999740570000 |
| admin | 0 |
| addonTreasury | 2000000720000 |


**extendedLoanPreviewWithoutTimestamps**
```
Object {
  "addonAmount": 20000n,
  "borrowedAmount": 100000000n,
  "borrower": "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "discountAmount": 0n,
  "durationInPeriods": 10n,
  "firstInstallmentId": 0n,
  "installmentCount": 1n,
  "interestRatePrimary": 100000000n,
  "interestRateSecondary": 200000000n,
  "lateFeeAmount": 0n,
  "outstandingBalance": 0n,
  "penalizedBalance": 700000000n,
  "programId": 1n,
  "repaidAmount": 259430000n,
  "trackedBalance": 0n,
}
```

</details>

## Single-installment loan that is fully repaid one day after the due date

| Idx | Caller | Contract | Name | Args |
| --- | ------ | -------- | ---- | ---- |
| 1 | admin | LM | takeInstallmentLoan | [borrower, 1, [100000000], [20000], [10], [700000000]] |
| 2 | stranger | LM | repayLoan | [0, 1157920892..3129639935] |

```mermaid
sequenceDiagram
  actor admin
  actor stranger
  participant LM
  participant LP
  participant addonTreasury
  participant borrower
  rect rgb(230,255,230)
    admin->>LM: admin calls LM.takeInstallmentLoan
    Note over CL: CL.OnBeforeLoanTakenCalled
    Note over LM: LM.LoanTaken
    Note over LM: LM.LoanTakenDetailed
    Note over LM: LM.InstallmentLoanTaken
    Note over LP: LP.OnBeforeLiquidityOutCalled
    LP-->>borrower: BRLC.Transfer: LP -> borrower (100000000)
    Note over LP: LP.OnBeforeLiquidityOutCalled
    LP-->>addonTreasury: BRLC.Transfer: LP -> addonTreasury (20000)
    Note over LM: LM.LoanPenalizedBalanceUpdated
  end
  rect rgb(230,255,230)
    stranger->>LM: stranger calls LM.repayLoan
    Note over LP: LP.OnBeforeLiquidityInCalled
    stranger-->>LP: BRLC.Transfer: stranger -> LP (856800000)
    Note over CL: CL.OnAfterLoanPaymentCalled
    Note over LM: LM.LoanRepayment
  end
```

<details>
<summary>Step 0: LM.takeInstallmentLoan</summary>

- **type**: methodCall
- **caller**: admin
- **args**: `{
  "borrower": "borrower",
  "programId": "1",
  "borrowedAmounts": "[100000000]",
  "addonAmounts": "[20000]",
  "durationsInPeriods": "[10]",
  "penalizedBalances": "[700000000]"
}`

**Events**

| # | Contract | Event | Args |
| - | -------- | ----- | ---- |
| 1 | CL | OnBeforeLoanTakenCalled | `[0]` |
| 2 | LM | LoanTaken | `[0, borrower, 100020000, 10]` |
| 3 | LM | LoanTakenDetailed | `[0, borrower, 1, CL, LP, 100000000, 20000, 10, 100000000, 200000000]` |
| 4 | LM | InstallmentLoanTaken | `[0, borrower, 1, 1, 100000000, 20000]` |
| 5 | LP | OnBeforeLiquidityOutCalled | `[100000000]` |
| 6 | BRLC | Transfer | `[LP, borrower, 100000000]` |
| 7 | LP | OnBeforeLiquidityOutCalled | `[20000]` |
| 8 | BRLC | Transfer | `[LP, addonTreasury, 20000]` |
| 9 | LM | LoanPenalizedBalanceUpdated | `[0, 700000000, 0]` |

**Balances**

**Token:** BRLC
| Holder | Balance |
| ------ | ------- |
| LM | 0 |
| LP | 1299899280000 |
| CL | 0 |
| BRLC | 0 |
| deployer | 0 |
| owner | 2000000000000 |
| borrower | 2700100000000 |
| stranger | 2000000000000 |
| admin | 0 |
| addonTreasury | 2000000720000 |


**extendedLoanPreviewWithoutTimestamps**
```
Object {
  "addonAmount": 20000n,
  "borrowedAmount": 100000000n,
  "borrower": "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "discountAmount": 0n,
  "durationInPeriods": 10n,
  "firstInstallmentId": 0n,
  "installmentCount": 1n,
  "interestRatePrimary": 100000000n,
  "interestRateSecondary": 200000000n,
  "lateFeeAmount": 0n,
  "outstandingBalance": 100020000n,
  "penalizedBalance": 700000000n,
  "programId": 1n,
  "repaidAmount": 0n,
  "trackedBalance": 100020000n,
}
```

</details>
<details>
<summary>Step 1: LM.repayLoan</summary>

- **type**: methodCall
- **caller**: stranger
- **args**: `{
  "loanId": "0",
  "repaymentAmount": "1157920892..3129639935"
}`

**Events**

| # | Contract | Event | Args |
| - | -------- | ----- | ---- |
| 1 | LP | OnBeforeLiquidityInCalled | `[856800000]` |
| 2 | BRLC | Transfer | `[stranger, LP, 856800000]` |
| 3 | CL | OnAfterLoanPaymentCalled | `[0, 856800000]` |
| 4 | LM | LoanRepayment | `[0, stranger, borrower, 856800000, 0]` |

**Balances**

**Token:** BRLC
| Holder | Balance |
| ------ | ------- |
| LM | 0 |
| LP | 1300756080000 |
| CL | 0 |
| BRLC | 0 |
| deployer | 0 |
| owner | 2000000000000 |
| borrower | 2700100000000 |
| stranger | 1999143200000 |
| admin | 0 |
| addonTreasury | 2000000720000 |


**extendedLoanPreviewWithoutTimestamps**
```
Object {
  "addonAmount": 20000n,
  "borrowedAmount": 100000000n,
  "borrower": "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "discountAmount": 0n,
  "durationInPeriods": 10n,
  "firstInstallmentId": 0n,
  "installmentCount": 1n,
  "interestRatePrimary": 100000000n,
  "interestRateSecondary": 200000000n,
  "lateFeeAmount": 14000000n,
  "outstandingBalance": 0n,
  "penalizedBalance": 700000000n,
  "programId": 1n,
  "repaidAmount": 856800000n,
  "trackedBalance": 0n,
}
```

</details>

