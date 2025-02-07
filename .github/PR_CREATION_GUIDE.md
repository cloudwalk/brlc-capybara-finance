# Pull Request Creation Guide

## Common Pitfalls to Avoid

1. Missing Code Snippets
   - Always include code snippets in `<details>` tags for smart contract changes
   - Show both before and after states for significant changes
   - Include comments explaining complex logic

2. Incorrect Version Numbers
   - Version must follow semver format (vX.Y.Z)
   - Major version (X) for breaking changes
   - Minor version (Y) for new features
   - Patch version (Z) for bug fixes

3. Incomplete Test Coverage
   - All new code must have test coverage
   - Document any temporary coverage gaps
   - Include coverage metrics in PR

4. Migration Steps
   - Required for any breaking changes
   - Must include both upgrade and rollback steps
   - Consider effects on dependent contracts

## Choosing the Right Template

### Smart Contract Changes
If your PR includes changes to files in the `contracts/` directory:
- Use the `smart_contract.md` template
- Required sections:
  1. Main changes (with code snippets in `<details>` tags)
  2. Versioning (format: `vX.Y.Z`)
  3. Test Coverage (with detailed metrics)
  4. Migration Steps (if needed)
  5. Further Improvements (optional)

### Other Changes
For all other changes:
- Use the default template
- Required sections:
  1. Description
  2. Changes
  3. Testing
  4. Additional Information

## Verification Steps

### For Smart Contract PRs
1. Run tests locally:
   ```bash
   npm run test
   ```
2. Check test coverage:
   ```bash
   npm run coverage
   ```
3. Verify version number update in:
   - Contract files
   - Package files
4. Include migration steps if your changes:
   - Modify existing contract interfaces
   - Change data structures
   - Affect contract upgradeability

### For All PRs
1. Follow conventional commit format for PR title:
   - Format: `type(scope): description`
   - Types: feat, fix, docs, style, refactor, perf, test, chore
   - Example: `feat(lending): add late fee policy`

2. Ensure all sections are properly filled out
3. Include relevant code snippets in collapsible sections
4. Link related issues and PRs

## Detailed Examples

### Smart Contract PR Examples

#### Example 1: Adding New Features (PR #43)
```markdown
## Main changes
1. A possibility to process installment loans has been added to the lending market smart-contract.
2. Each installment loan consists of several sub-loans that represent installments.

<details>
<summary>Implementation Details</summary>

```solidity
struct State {
    uint32 programId;             // The unique identifier of the program.
    uint64 borrowAmount;          // The initial borrow amount
    // ... more fields
}
```
</details>

## Versioning
The new version of the smart contracts is `v1.4.0`.

## Test Coverage
<details>
<summary>Test coverage details</summary>

| File                    | % Stmts | % Branch | % Funcs |
|------------------------|---------|----------|---------|
| contracts/             | 100.00  | 99.00    | 100.00  |
</details>
```

#### Example 2: Access Control Changes (PR #56)
```markdown
## Main changes
1. Access control system reorganized
2. New role hierarchy implemented

## Migration Steps
1. Deploy new access control contract
2. Transfer existing roles
3. Update dependent contracts

## Test Coverage
All new access control logic is covered by unit tests
```

#### Example 3: Fee Implementation (PR #45)
```markdown
## Main changes
1. Late fee calculation logic added
2. Fee collection mechanism implemented

## Versioning
Update to `v1.5.0` for new fee feature

## Test Coverage
New fee calculation functions have 100% coverage
```

These examples demonstrate:
- Clear, numbered main changes
- Detailed implementation snippets
- Proper version updates
- Comprehensive test coverage
- Migration steps when needed
