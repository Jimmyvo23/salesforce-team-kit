# Salesforce Code Analyzer (v5): commands, severities, rules

Check flags with `sf code-analyzer run --help` on the machine you're on; this file was written against the help text of plugin `code-analyzer` 5.14.0.

## Commands

```bash
# Changed files only (preferred), fail on Critical or High
sf code-analyzer run --target force-app/main/default/classes/DiscountJob.cls --target force-app/main/default/classes/DiscountJobTest.cls --severity-threshold 2 --view detail

# Whole package directory when the change set is unclear
sf code-analyzer run --target force-app --severity-threshold 2 --view detail

# Only the security and performance rules from PMD at any severity
sf code-analyzer run --target force-app --rule-selector "pmd:(Security,Performance)" --view detail

# See which rules, tags and severities exist
sf code-analyzer rules --rule-selector all
```

- `--target` (`-t`): file, folder or glob, repeatable; must be inside the workspace (`--workspace`, default `.`). Some engines need the whole workspace to analyse a target, so run from the project root.
- `--rule-selector` (`-r`): default `Recommended`. Combine with colons (AND), commas (OR) and parentheses; quote selectors with parentheses.
- `--severity-threshold` (`-s`): a number (`2`) or name (`High`). A violation at that severity **or more severe** makes the command exit non-zero.
- `--view detail` shows every field of each violation; `table` is the short default.
- `--output-file` (`-f`) writes `.json`, `.csv`, `.html`, `.sarif` or `.xml`. The reviewer is read-only, so prefer the terminal view.
- A `code-analyzer.yml` in the project root is applied automatically. Check it for rules whose severity was lowered, and for suppressions. `--no-suppressions` ignores inline `code-analyzer-suppress` markers; use it when a suppression hides a blocking rule on changed lines.

## Severities

| Number | Name | Verdict |
|---|---|---|
| 1 | Critical | Blocks |
| 2 | High | Blocks |
| 3 | Moderate | Blocks for Security-tagged rules and `OperationWithLimitsInLoop` on changed lines; otherwise fix or justify in the handoff |
| 4 | Low | Note |
| 5 | Info | Note |

The retired `sf scanner` (v3/v4) used **1 high, 2 moderate, 3 low**. A team rule written for the old scanner ("block on severity 1 and 2") meant high and moderate; restate it with names.

In the JSON output, `violationCounts` holds `total` and `sev1`…`sev5`; `sev1` + `sev2` > 0 means Changes needed.

## Rules that map to the checklist (PMD engine)

| Checklist item | Rule |
|---|---|
| CRUD/FLS | `ApexCRUDViolation` |
| Sharing | `ApexSharingViolations` |
| SOQL injection | `ApexSOQLInjection` |
| SOQL/DML in loops | `OperationWithLimitsInLoop` |
| Hard-coded Ids | `AvoidHardcodingId` |
| Tests without asserts | `ApexUnitTestClassShouldHaveAsserts` |

The severity each rule gets depends on the engine defaults and `code-analyzer.yml`, so read it from the output instead of assuming it. A checklist failure blocks even if the analyzer rated it Moderate or didn't report it.

## Reading the result

1. Exit code: non-zero with `--severity-threshold 2` = at least one Critical/High.
2. For each violation: severity, rule, `file:line`, message. Keep only changed files and lines for blocking notes; mention pre-existing violations in other files as a Note.
3. Put the command and the counts per severity in the verdict.
4. Not run (no shell, plugin missing)? Say so, give the command, and don't approve.
