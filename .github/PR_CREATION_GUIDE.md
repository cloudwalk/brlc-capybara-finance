# Pull Request Creation Guide

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

## Examples

### Smart Contract PR Example
See these exemplary PRs:
- [#56](https://github.com/cloudwalk/brlc-capybara-finance/pull/56) - Access control reorganization
- [#45](https://github.com/cloudwalk/brlc-capybara-finance/pull/45) - Late fee implementation
- [#43](https://github.com/cloudwalk/brlc-capybara-finance/pull/43) - Installments feature

These PRs demonstrate proper:
- Code snippet formatting
- Version number updates
- Test coverage documentation
- Migration steps (when needed)
