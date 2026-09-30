# General Version Classification Examples

These examples use SemVer as a common default, not a universal requirement. Follow the target repository's documented format and compatibility policy whenever one exists.

| Change scope | SemVer example | Typical interpretation |
| --- | --- | --- |
| Backward-compatible bug fix | `1.4.2` to `1.4.3` | Increment `PATCH`. |
| Backward-compatible feature | `1.4.3` to `1.5.0` | Increment `MINOR`; reset `PATCH`. |
| Incompatible public API or behavior | `1.5.0` to `2.0.0` | Increment `MAJOR`; reset lower fields. |
| Pre-release iteration | `2.0.0-rc.1` to `2.0.0-rc.2` | Preserve the pre-release scheme until the project promotes a final release. |
| Calendar version | `2026.09` to `2026.10` | Follow the repository's calendar and rollover rules. |
| Custom multi-part version | e.g. `0.5.6.3` to `0.5.7.0` | Use only when the repository defines each segment and the target ecosystem accepts that format. |

## Classification Notes

- Version only the package or component affected by the delivery; monorepos may have independent version histories.
- A documentation or test change does not inherently require a version bump. Check repository policy and release intent.
- Respect any compatibility guarantees, pre-release channels, epoch rules, or custom segment meanings already in use.
- Hard ecosystem constraints take precedence over internal numbering preferences. If the ecosystem requires `MAJOR.MINOR.PATCH`, keep exactly three numeric components; use Git tags/releases, not a fourth component, to distinguish published versions.
- Never reuse an identifier already assigned to a published release. Inspect tags and release records using version-aware comparison.
- Do not infer release scope from file count or lines changed. If the policy or intended package cannot be established, ask before editing versions.