# Case study: building `rule-lite`

## The problem

Enterprise UIs — especially in regulated domains like banking and insurance — are full of conditional logic: show this field only if that one is set, enable this section for certain roles, gate a feature behind an entitlement flag. In most codebases this logic ends up as scattered `*ngIf` expressions or nested `if` statements, which creates two recurring problems:

1. **It's not data.** The rules live in TypeScript, so a product manager or config team can't change "show discount field if country is IN or role is admin" without a code change and a deploy.
2. **It's not testable in isolation.** The condition is buried inside a component, so verifying it means rendering the component rather than asserting on a pure function.

I've built variants of this internally as part of a JSON-driven rule engine for dynamic forms. `rule-lite` is a from-scratch, open-source, framework-agnostic distillation of that same idea, small enough to read end-to-end in five minutes.

## Design goals

- **Serializable.** A rule must be plain JSON — storable in a database row, a CMS field, or a static config file, and diffable in a PR.
- **Composable.** Real-world conditions nest (`A and (B or not C)`), so `all` / `any` / `not` needed to combine recursively without a special case for depth.
- **Small and dependency-free.** The whole engine is under 100 lines of runtime logic. No lodash, no runtime schema library — anyone auditing it for a security review can read the entire implementation in one sitting.
- **Extensible without forking.** Built-in operators cover the 80% case (`eq`, `gt`, `in`, `contains`, ...), but real systems always need one domain-specific operator. `registerOperator` and the `operators` constructor option let consumers add their own without touching the library source.
- **Framework-agnostic.** The API takes a plain object as context and returns a boolean — no dependency on Angular, React, or Node-specific APIs, so the same rule definitions can run in a browser, on a server, or inside a CLI validation script.

## API shape trade-offs

I considered three shapes for the rule tree before settling on the current one:

1. **String-based DSL** (e.g. `"age >= 18 && country == 'IN'"`) — most compact to author, but requires a parser, isn't safely JSON-serializable without escaping, and is harder to validate/lint before evaluation. Rejected: too much surface area for a "lite" package.
2. **Array-based JsonLogic-style** (e.g. `{"and": [{">=": [{"var": "age"}, 18]}]}`) — this is what JsonLogic itself does. Very compact, but unreadable without the spec open next to it, and single-letter operator keys collide easily with real field names.
3. **Object-based conditions with named `field` / `operator` / `value` keys** (what shipped) — slightly more verbose JSON, but self-documenting, trivial to build a form-builder UI around (a `<select>` for `field`, a `<select>` for `operator`, an input for `value`), and maps cleanly onto how non-engineers already think about rules ("if age is greater than or equal to 18").

Readability and "can a non-engineer configure this in a UI" won over raw compactness, since that's the actual use case (dynamic forms and business rules maintained outside of code).

## Why unary operators keep the same `Condition` shape

Operators like `exists`, `truthy`, and `falsy` don't need a `value`. Rather than introducing a separate condition type for arity, `value` is simply optional (`value?: unknown`) and unary operator functions ignore their second argument. This keeps the type surface to a single `Condition` interface instead of a union of arity-specific shapes, at the cost of `value` being technically valid-but-unused on those five operators — a trade-off toward a simpler type system.

## What's next

- Publish `0.1.0` to npm once a couple of real consumers have exercised the API.
- Add an optional Angular adapter package (`rule-lite-angular`) exposing a `RuleEngineModule` / injectable service and a structural directive (`*ruleLet`) for template-level use, once the core API has stabilized from real usage.
- Consider a `validate(rule)` function that checks a rule tree against the registered operator set before evaluation, useful for catching typos in admin-authored JSON before it reaches production.
