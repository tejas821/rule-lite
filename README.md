# rule-lite

[![CI](https://github.com/tejas821/rule-lite/actions/workflows/ci.yml/badge.svg)](https://github.com/tejas821/rule-lite/actions/workflows/ci.yml)
[![Security](https://github.com/tejas821/rule-lite/actions/workflows/security.yml/badge.svg)](https://github.com/tejas821/rule-lite/actions/workflows/security.yml)
[![npm version](https://img.shields.io/npm/v/rule-lite.svg)](https://www.npmjs.com/package/rule-lite)
![runtime dependencies](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen)

A tiny, dependency-free TypeScript rule engine. **v1** evaluates JSON-defined conditional logic (used for feature flags, entitlements, and business rules). **v2** adds a form-action engine on top: turn the same kind of JSON rules into dynamic form behavior — set a value, apply validators, filter a dropdown, show/hide a field — driven by plain data, with zero UI framework coupling.

v2 is wire-compatible with v1. If you're already using `RuleEngine`/`evaluate`, nothing changes for you; upgrading is safe and the new form-action layer is entirely additive.

**What's new in 2.1.0** (backward-compatible additions, see [changelog](#changelog)): nested dot-path `setValue`/`resetValue` targets now write correctly instead of silently failing to nest; a new `{ object: {...} }` `ValueExpression` shape for computing a whole sub-object in one `setValue`; `toNumber`/`toString`/`toBoolean` expression functions for coercing string-typed form values before math/logic; a field-centric `compileFieldConfig()` authoring adapter; and a read-only `getRuleTree()`/`formatRuleTree()` inspection utility for previewing a rule set's dependency graph.

## Install

```bash
npm install rule-lite
```

## Contents

- [v1 — condition evaluation](#v1--condition-evaluation) (unchanged)
- [v2 — dynamic form rules](#v2--dynamic-form-rules)
- [Business example: loan application form](#business-example-loan-application-form)
- [Business example: checkout with cascading location dropdowns](#business-example-checkout-with-cascading-location-dropdowns)
- [Config reference](#config-reference)
- [Evaluation modes & cascading](#evaluation-modes--cascading)
- [Conflict resolution](#conflict-resolution)
- [Cycle protection](#cycle-protection)
- [Field-centric config: compileFieldConfig()](#field-centric-config-compilefieldconfig)
- [Inspecting rules: tree preview](#inspecting-rules-tree-preview)
  - [How you'd actually use this](#how-youd-actually-use-this)
- [Angular Reactive Forms integration](#angular-reactive-forms-integration)
- [Debugging: explain mode & errors](#debugging-explain-mode--errors)
- [Security](#security)
- [Changelog](#changelog)

---

## v1 — condition evaluation

A `Rule` is either a leaf `Condition` (`{ field, operator, value }`) or a composite (`all` / `any` / `not`) of other rules, evaluated against a plain object.

```ts
import { RuleEngine, evaluate } from 'rule-lite';

const rule = {
  all: [
    { field: 'age', operator: 'gte', value: 18 },
    { any: [{ field: 'country', operator: 'eq', value: 'IN' }, { field: 'country', operator: 'eq', value: 'US' }] },
  ],
};

evaluate(rule, { age: 25, country: 'IN' }); // true

const engine = new RuleEngine({ operators: { divisibleBy: (a, b) => a % b === 0 } });
engine.evaluate({ field: 'n', operator: 'divisibleBy', value: 5 }, { n: 25 }); // true
```

Built-in operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `notIn`, `contains`, `startsWith`, `endsWith`, `exists`, `notExists`, `truthy`, `falsy`. Register your own with `registerOperator` or the constructor's `operators` option (`new RuleEngine({ operators: { divisibleBy: (a, b) => a % b === 0 } })`, or `RuleEngineOptions` if you're typing it yourself).

A `Condition`'s `field` supports dot paths (`{ field: 'address.city', operator: 'eq', value: 'Pune' }`) — reads go through the exported `getByPath(obj, path)` helper, the same one used internally for every field lookup:

```ts
import { getByPath } from 'rule-lite';

getByPath({ address: { city: 'Pune' } }, 'address.city'); // 'Pune'
getByPath({ address: {} }, 'address.zip'); // undefined — missing segments never throw
```

## v2 — dynamic form rules

The form-action engine compiles a `FormRuleConfig` (a list of `{ id, when, then }` rules) into an evaluator: `evaluate(formData, options) → { patch, passes, warnings }`. `patch` is a plain object describing what changed — nothing more:

```ts
type Patch = Record<string, PatchEntry>;

interface PatchEntry {
  value?: unknown;
  validators?: ValidatorSpec;
  crossFieldErrors?: Record<string, string>;
  options?: unknown[];
  visible?: boolean;
  disabled?: boolean;
}
```

Both `Patch` and `PatchEntry` are exported directly if you want to type your own patch-consuming code (e.g. a `function applyPatch(patch: Patch) { ... }` outside rule-lite).

You apply the patch however fits your UI — spread it into React state, loop over it for Angular's `FormGroup`, or hand it to `applyPatchToFormGroup` (included, see below). The engine never touches a DOM node or a form library.

### Quick start

```ts
import { compileFormRules } from 'rule-lite';

const config = {
  rules: [
    {
      id: 'requireItrForSelfEmployed',
      when: { field: 'employmentType', operator: 'eq', value: 'self-employed' },
      then: [{ action: 'setValidation', target: 'itrDocument', validators: { required: true } }],
    },
  ],
};

const engine = compileFormRules(config);
const { patch } = engine.evaluate({ employmentType: 'self-employed' });
// patch.itrDocument.validators === { required: true }
```

Nine action types cover the common form behaviors:

| action | what it does |
| --- | --- |
| `setValue` | compute a value from an expression and write it to a field |
| `resetValue` | clear a field (to `null` or a computed value), ignoring dirty state |
| `setValidation` | apply validators (`required`, `min`, `max`, `minLength`, `maxLength`, `pattern`, `custom`) |
| `crossFieldValidation` | validate one field against another (`endDate` after `startDate`, etc.) |
| `filterDropdown` | filter an options list by matching a key against another field's value |
| `setOptions` | replace a dropdown's full options list |
| `show` / `hide` | toggle visibility |
| `enable` / `disable` | toggle whether a field is editable |

`setValidation`'s `validators` is a plain `ValidatorSpec`, kept JSON-serializable — `pattern` is a regex *source string*, not a `RegExp` instance, and `custom` names a function you supply, not the function itself:

```ts
interface ValidatorSpec {
  required?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;                 // regex source, e.g. '^[A-Z]{2}\\d{4}$'
  custom?: string;                  // key into EvaluateOptions.customValidators
}
```

`crossFieldValidation` compares `target` against `otherField` using the same `compare` shape (`eq`/`neq`/`gt`/`gte`/`lt`/`lte`) as v1 operators; this shape is also exported standalone as `CrossFieldRule` (`{ compare, otherField, message? }`, without the `action`/`target` wrapper) if you want to reuse it outside a `CrossFieldValidationAction`.

`target` (and `resetValue`'s implicit target) supports dot paths. Internally, the engine now writes through `setByPath` instead of a flat assignment, so a nested `target: 'address.city'` correctly builds/updates the nested `address` object in the engine's working form state (any sibling keys already on `address` are preserved) — and a later rule in the same cascade that reads `{ field: 'address.city' }` sees the updated value, exactly as it always has for reads. This mirrors how `{ field: 'address.city' }` reads have always worked — reads and writes are now symmetric for nested paths.

The returned `Patch` is still keyed by the literal target string (`patch['address.city'] = { value: 'Pune' }`), so when you apply a patch to your own nested form state, use the exported `setByPath(formState, key, patch[key].value)` helper (the same one the engine uses internally) rather than `formState[key] = ...`:

```ts
import { setByPath } from 'rule-lite';

for (const [key, entry] of Object.entries(patch)) {
  if ('value' in entry) setByPath(formData, key, entry.value);
}
// formData.address.city === 'Pune'
```

Values are computed with `ValueExpression` — a small, safe, **JSON-only** grammar (no `eval`, no `Function` constructor, so it's safe even if a config is ever authored outside your own code):

| shape | what it does |
| --- | --- |
| `{ const: 42 }` | a literal |
| `{ field: 'income' }` | read a field (supports dot paths) |
| `{ fn: 'add', args: [...] }` | call a registered expression function (see below) |
| `{ if: Rule, then: ValueExpression, else: ValueExpression }` | branch on a regular v1 `Rule` — no new condition syntax to learn |
| `{ object: { key: ValueExpression, ... } }` | compute a whole JSON sub-object in one shot; each value is itself any `ValueExpression` and can nest arbitrarily |

```ts
{ const: 42 }                                    // a literal
{ field: 'income' }                              // read a field (supports dot paths)
{ fn: 'add', args: [{ field: 'price' }, { field: 'tax' }] }   // add, sub, mul, div, mod, concat, coalesce, min, max, round, len, upper, lower, toNumber, toString, toBoolean
{ if: { field: 'income', operator: 'gt', value: 500000 }, then: { const: 'high' }, else: { const: 'medium' } }
{ object: {
    total: { fn: 'add', args: [{ field: 'subtotal' }, { field: 'tax' }] },
    label: { fn: 'concat', args: [{ const: 'Order #' }, { field: 'orderId' }] },
  } }
```

A `setValue` action can write the whole computed object to a single target in one pass — e.g. `{ action: 'setValue', target: 'orderSummary', value: { object: { total: ..., label: ... } } }` produces `patch.orderSummary.value === { total: 275, label: 'Order #4821' }` — instead of needing one `setValue` rule per sub-field.

Two form controls both typed as text will hand you strings, so `{ fn: 'add', args: [{ field: 'qty' }, { field: 'price' }] }` string-concatenates instead of summing if `qty`/`price` arrive as `"3"`/`"9.5"`. Wrap each read in `toNumber` to coerce first: `{ fn: 'add', args: [{ fn: 'toNumber', args: [{ field: 'qty' }] }, { fn: 'toNumber', args: [{ field: 'price' }] }] }` → `12.5`. `toString` and `toBoolean` coerce the other directions the same way.

Register a custom `{ fn }` for one evaluation without touching the global set by passing `fns` on `EvaluateOptions` (see [Evaluation modes & cascading](#evaluation-modes--cascading)) — `engine.evaluate(formData, { fns: { discount: (price, pct) => price * (1 - pct) } })` makes `{ fn: 'discount', args: [...] }` resolve for that call only. Internally this is the same `ExprOptions` shape (`{ fns?: Record<string, ExprFn> }`) that `evaluateExpression()` itself takes, if you're calling the expression evaluator directly.

A few small graph-building utilities are exported for anyone writing their own tooling on top of a config (rule-lite's own dependency graph, `getRuleTree()`, and `compileFormRules()`'s cycle detection are all built from these):

```ts
import { collectRuleFields, collectExpressionFields, collectActionFields } from 'rule-lite';

collectRuleFields({ all: [{ field: 'a', operator: 'eq', value: 1 }, { field: 'b', operator: 'exists' }] });
// Set { 'a', 'b' } — every field path a Rule reads, recursing all/any/not

collectExpressionFields({ object: { x: { field: 'income' }, y: { fn: 'add', args: [{ field: 'tax' }, { const: 1 }] } } });
// Set { 'income', 'tax' } — every field path a ValueExpression reads

const out = new Set<string>();
collectActionFields({ action: 'filterDropdown', target: 'city', source: { field: 'allCities' }, matchKey: 'state', matchValue: { field: 'state' } }, out);
// out -> Set { 'allCities', 'state' } — every field path a FieldAction's own expressions (value/source/matchValue/options/otherField) read
```

---

## Business example: loan application form

A loan form where self-employed applicants need an extra document, the risk tier is computed from income, and the loan tenure must be validated against the applicant's age at maturity.

```ts
import { compileFormRules } from 'rule-lite';

const loanFormRules = {
  rules: [
    // 1. Self-employed applicants must upload an ITR document.
    {
      id: 'requireItrForSelfEmployed',
      when: { field: 'employmentType', operator: 'eq', value: 'self-employed' },
      then: [{ action: 'setValidation', target: 'itrDocument', validators: { required: true } }],
    },

    // 2. Salaried applicants must upload their latest payslip instead.
    {
      id: 'requirePayslipForSalaried',
      when: { field: 'employmentType', operator: 'eq', value: 'salaried' },
      then: [{ action: 'setValidation', target: 'payslip', validators: { required: true } }],
    },

    // 3. Risk tier is computed from income — a suggestion the user can still edit (no `force`).
    {
      id: 'computeRiskTier',
      when: { all: [] },
      then: [{
        action: 'setValue',
        target: 'riskTier',
        value: {
          if: { field: 'income', operator: 'gt', value: 1500000 },
          then: { const: 'low' },
          else: {
            if: { field: 'income', operator: 'gt', value: 500000 },
            then: { const: 'medium' },
            else: { const: 'high' },
          },
        },
      }],
    },

    // 4. High risk tier requires a co-applicant field to be shown and required.
    {
      id: 'requireCoApplicantForHighRisk',
      when: { field: 'riskTier', operator: 'eq', value: 'high' },
      then: [
        { action: 'show', target: 'coApplicantName' },
        { action: 'setValidation', target: 'coApplicantName', validators: { required: true, minLength: 2 } },
      ],
    },
    {
      id: 'hideCoApplicantOtherwise',
      when: { field: 'riskTier', operator: 'neq', value: 'high' },
      then: [{ action: 'hide', target: 'coApplicantName' }],
    },

    // 5. Tenure must end before the applicant turns 65 (a cross-field-style business rule
    //    expressed as a value expression rather than a two-field comparison).
    {
      id: 'capTenureByAge',
      when: { all: [{ field: 'age', operator: 'exists' }, { field: 'loanTenureYears', operator: 'exists' }] },
      then: [{
        action: 'setValidation',
        target: 'loanTenureYears',
        validators: { max: 65 }, // combined with a max computed elsewhere, e.g. 65 - age via a setValue rule feeding a "maxTenure" field
      }],
    },

    // 6. Disbursement date must be after the approval date.
    {
      id: 'disbursementAfterApproval',
      when: { all: [] },
      then: [{
        action: 'crossFieldValidation',
        target: 'disbursementDate',
        compare: 'gt',
        otherField: 'approvalDate',
        message: 'Disbursement date must be after the approval date',
      }],
    },
  ],
};

const engine = compileFormRules(loanFormRules);

const { patch } = engine.evaluate({
  employmentType: 'self-employed',
  income: 300000,
  age: 40,
  loanTenureYears: 20,
  approvalDate: 20260101,
  disbursementDate: 20251201, // before approval — will fail
});

// patch.itrDocument.validators        -> { required: true }
// patch.riskTier.value                -> 'high'
// patch.coApplicantName.visible       -> true
// patch.coApplicantName.validators    -> { required: true, minLength: 2 }
// patch.disbursementDate.crossFieldErrors.disbursementAfterApproval
//   -> 'Disbursement date must be after the approval date'
```

Notice rule 4/5 aren't wired together explicitly — the engine's dependency graph figures out that `riskTier` changing (from rule 3) should re-trigger rules 4 and 5 automatically, cascading through in one `evaluate()` call.

---

## Business example: checkout with cascading location dropdowns

A shipping form where country filters the state dropdown, state filters the city dropdown, and changing an upstream field clears the downstream ones — the canonical "deep cascade" case.

```ts
const checkoutRules = {
  rules: [
    {
      id: 'filterStatesByCountry',
      when: { field: 'country', operator: 'exists' },
      then: [{ action: 'filterDropdown', target: 'state', source: { field: 'allStates' }, matchKey: 'country', matchValue: { field: 'country' } }],
    },
    {
      id: 'filterCitiesByState',
      when: { field: 'state', operator: 'exists' },
      then: [{ action: 'filterDropdown', target: 'city', source: { field: 'allCities' }, matchKey: 'state', matchValue: { field: 'state' } }],
    },
    // Clear the state whenever country changes to ANY value — including being cleared.
    // `when` must stay value-independent here, so `dependsOn` wires up the field link.
    {
      id: 'resetStateOnCountryChange',
      when: { all: [] },
      dependsOn: ['country'],
      then: [{ action: 'resetValue', target: 'state' }],
    },
    {
      id: 'resetCityOnStateChange',
      when: { all: [] },
      dependsOn: ['state'],
      then: [{ action: 'resetValue', target: 'city' }],
    },
    // International shipping fee only applies outside India.
    {
      id: 'internationalFee',
      when: { field: 'country', operator: 'neq', value: 'IN' },
      then: [{ action: 'setValue', target: 'shippingFee', value: { const: 25 }, force: true }],
    },
    {
      id: 'domesticFee',
      when: { field: 'country', operator: 'eq', value: 'IN' },
      then: [{ action: 'setValue', target: 'shippingFee', value: { const: 0 }, force: true }],
    },
  ],
};

const engine = compileFormRules(checkoutRules);

// The user just changed "country" — pass changedFields so only the affected
// rules re-run instead of re-evaluating the whole form.
const { patch, passes } = engine.evaluate(
  { country: 'US', state: 'MH', city: 'Pune', allStates, allCities },
  { changedFields: ['country'] }
);

// patch.state.value   -> null            (reset)
// patch.city.value    -> null            (reset, cascaded from state's reset)
// patch.state.options -> US states only
// patch.shippingFee.value -> 25
// passes -> 2 (country -> state/fee, then state -> city)
```

---

## Config reference

```ts
interface FormRuleConfig {
  fields?: string[];          // optional, documentary only
  rules: FieldRule[];
}

interface FieldRule {
  id: string;                 // must be unique
  when: Rule;                 // a v1 Rule — condition/all/any/not
  then: FieldAction[];        // one or more actions to apply when `when` matches
  priority?: number;          // higher wins same-target conflicts; default 0
  enabled?: boolean;          // default true
  dependsOn?: string[];       // extra field deps beyond what's auto-detected (see below)
}
```

`dependsOn` matters when a rule's `when` is value-independent (e.g. `{ all: [] }`, always true) but should still re-run whenever a specific field changes — including changing to `null`/`undefined`. Without it, a rule like "clear the city whenever state changes" would stop firing the moment state *becomes* empty, since the dependency graph is normally built only from fields actually referenced inside `when`/`then`.

## Evaluation modes & cascading

```ts
engine.evaluate(formData, {
  mode?: 'cascade' | 'full';   // defaults to 'cascade' if changedFields given, else 'full'
  changedFields?: string[];    // seeds the cascade — the field(s) that just changed
  addonData?: object;          // extra read-only data merged into the context (e.g. lookups, feature flags)
  dirtyFields?: Iterable<string>; // fields the user has manually edited
  maxCascadeDepth?: number;    // default 50
  explain?: boolean;           // return a per-pass trace
  fns?: object;                // extra/override ValueExpression functions
  customValidators?: object;   // named validators referenced by ValidatorSpec.custom
});
```

On a field change, theengine seeds a worklist with only the rules that directly depend on that field (from a dependency graph built once at compile time), evaluates them, and — only for rules whose action **actually changed a value** — enqueues whatever rules depend on *that* field next. This repeats to a fixpoint. A long dependency chain (country → state → city → tax → total) fully resolves in one `evaluate()` call; an unrelated rule elsewhere in a large form is never touched. `mode: 'full'` (the default with no `changedFields`, e.g. on initial form load) evaluates every rule once regardless of dependencies.

## Conflict resolution

- **`setValue` / `resetValue`** on the same target: higher `priority` wins; ties break by declaration order, with the *later*-declared rule winning (so putting a more specific override rule after a general one works as expected).
- **`setValidation`**: validators from every matching rule are merged (additive) — `{ required: true }` from one rule and `{ max: 100 }` from another both apply.
- **`show`/`hide`** and **`enable`/`disable`**: the "restrictive" state always wins regardless of order — if *any* matching rule says hide, the field is hidden, even if another rule says show.
- **`filterDropdown` / `setOptions`**: last-matching-rule-wins (option lists can't be meaningfully merged).

## Cycle protection

Two rules that keep changing each other's fields (`A` sets `B`, `B` sets `A`, forever) can never reach a correct fixpoint. rule-lite guards this two ways:

1. **Compile-time**: `compileFormRules(config).warnings` includes a non-fatal message like `possible circular rule dependency: aSetsB -> bSetsA -> aSetsB`, computed via static graph analysis — useful for catching the mistake in code review before it ever runs.
2. **Runtime**: if a cascade exceeds `maxCascadeDepth` (default 50) passes without settling, `evaluate()` throws `RuleCascadeError` with the fields and candidate rule ids still changing — instead of hanging. A rule that keeps re-computing the *same* value is fine and reaches a fixpoint in one pass; only genuine oscillation trips the guard.

```ts
try {
  engine.evaluate(formData, { changedFields: ['a'] });
} catch (err) {
  if (err instanceof RuleCascadeError) {
    console.error(err.message, err.involvedFields, err.involvedRules);
  }
}
```

Compiled rule sets are cached by config object identity via `getCompiledFormRules(config)` — call it freely on every render/evaluation; the dependency graph and validation only run once per distinct config object.

The compiled engine also exposes its resolved dependency graph directly via `engine.getDependencyGraph()`, returning `{ field: string; ruleIds: string[] }[]` — one entry per field naming the rule ids that get re-evaluated when that field changes. This is the same mapping `evaluate({ changedFields })` uses internally to seed a cascade; read it if you're building your own "what does changing this field affect" tooling without going through the fuller `getRuleTree()` (below).

## Field-centric config: compileFieldConfig()

`compileFormRules()` takes a flat `{ rules: [...] }` config where every rule explicitly names its `target` field, decoupled from any definition of the fields themselves. Some teams instead model a form as a single array of field descriptors — label, type, validation, options, and now rules — with the field as the source of truth. `compileFieldConfig()` is an adapter for that authoring style: it takes an array of `FieldConfigEntry` objects, each carrying a `jsonattribute` (the field's key in the output JSON, and the implicit `target` for every rule declared on it) plus its own embedded `rules: []` array of field-scoped rules.

```ts
interface FieldConfigEntry {
  jsonattribute: string;      // the field's key in the output JSON; default target for its rules
  rules?: FieldConfigRule[];
  [meta: string]: unknown;    // label, type, defaultValue, options, ... — untouched by rule-lite
}

interface FieldConfigRule {
  when: Rule;
  action: FieldAction['action'];
  id?: string;                // defaults to `${jsonattribute}__${action}__${index}`
  target?: string;            // defaults to this field's own jsonattribute; override to act on a different field
  priority?: number;
  enabled?: boolean;
  dependsOn?: string[];
  [extra: string]: unknown;   // action-specific props: value/to/validators/compare/otherField/message/source/matchKey/matchValue/options
}
```

The loan-form example rewritten in fieldConfig style — `riskTier` computed from income, and `coApplicantName` shown/required when the risk tier the same field computes turns out high:

```ts
import { compileFieldConfig } from 'rule-lite';

const loanFieldConfig = [
  {
    jsonattribute: 'riskTier',
    label: 'Risk tier',
    rules: [
      {
        when: { all: [] },
        action: 'setValue',
        value: {
          if: { field: 'income', operator: 'gt', value: 1500000 },
          then: { const: 'low' },
          else: { const: 'high' },
        },
      },
    ],
  },
  {
    jsonattribute: 'coApplicantName',
    label: 'Co-applicant name',
    type: 'text',
    rules: [
      { when: { field: 'riskTier', operator: 'eq', value: 'high' }, action: 'show' },
      { when: { field: 'riskTier', operator: 'eq', value: 'high' }, action: 'setValidation', validators: { required: true, minLength: 2 } },
      { when: { field: 'riskTier', operator: 'neq', value: 'high' }, action: 'hide' },
    ],
  },
];

const engine = compileFieldConfig(loanFieldConfig);
const { patch } = engine.evaluate({ income: 300000 });
// patch.riskTier.value             -> 'high'
// patch.coApplicantName.visible    -> true
```

`fieldConfigToFormRuleConfig()` exposes just the transform step (fieldConfig array → flat `FormRuleConfig`) without compiling, if you need the intermediate shape for inspection or to merge with hand-written rules.

`compileFieldConfig()` produces the exact same `CompiledFormRuleSet` as `compileFormRules()` — same `evaluate()`, same `Patch` shape, same cascade/cycle/conflict-resolution semantics. It's purely a config authoring convenience, not a different engine.

## Inspecting rules: tree preview

`getRuleTree()` and `formatRuleTree()` are read-only inspection utilities — no `when` condition or value expression is ever evaluated. They walk a rule set's static dependency graph (which fields each rule reads and writes, and which other rules become candidates to fire next because they read a field this rule writes) and expose it as plain JSON or a quick indented text preview. Useful for debugging a large rule set or powering an admin/debug UI. Both accept either a flat `FormRuleConfig` or a field-centric `fieldConfig` array (auto-detected from whether the input is an array).

```ts
import { getRuleTree } from 'rule-lite';

const tree = getRuleTree(checkoutRules);
// tree.roots          -> RuleTreeNode[], the cascade's entry points (rules nothing else feeds into)
// tree.nodesById       -> every rule as a flat node, keyed by rule id
// tree.fieldToRuleIds  -> { country: ['filterStatesByCountry', 'resetStateOnCountryChange'], ... }
// tree.warnings        -> non-fatal notices, e.g. a detected cycle
```

Each entry in `roots`/`nodesById` is a `RuleTreeNode` (exported, along with `RuleTreeResult` and `RuleTreeActionSummary`):

```ts
interface RuleTreeNode {
  ruleId: string;
  when: Rule;                          // the rule's raw condition, unevaluated
  priority: number;
  enabled: boolean;
  readsFields: string[];               // this rule's trigger inputs (from `when` + action expressions)
  writesFields: string[];              // this rule's outputs
  actions: RuleTreeActionSummary[];    // [{ action: 'setValue', target: 'riskTier' }, ...]
  children: RuleTreeNode[];            // rules that read one of writesFields — what this rule cascades into
  cyclic?: boolean;                    // true where expanding further would revisit a rule already on this path
}
```

`formatRuleTree()` renders the same tree as a text preview for console/log use — each line is `ruleId  writes: field1, field2  (flags)`, with `├─`/`└─`/`│` connectors reserved for indenting a node under its parent when a rule set builds up multi-level branches:

```ts
import { formatRuleTree } from 'rule-lite';

console.log(formatRuleTree(checkoutRules));
```

```
filterStatesByCountry  writes: state
filterCitiesByState  writes: city
resetCityOnStateChange  writes: city
resetStateOnCountryChange  writes: state
filterCitiesByState  writes: city
resetCityOnStateChange  writes: city
internationalFee  writes: shippingFee
domesticFee  writes: shippingFee
```

Each root (a rule nothing else feeds into) starts a new block, followed by the rules that read a field it writes — `filterCitiesByState` and `resetCityOnStateChange` both read `state`, so both appear under `filterStatesByCountry` and again under `resetStateOnCountryChange`, since each also writes `state` and is walked independently.

A cycle doesn't throw here the way `evaluate()` would with `RuleCascadeError` — the node where the loop closes is marked `cyclic: true` in `getRuleTree()`'s output and rendered as `(cyclic ref)` in `formatRuleTree()`'s text, with a matching entry under `warnings`, so a rule set that would genuinely fail at evaluation time can still be previewed safely while authoring.

### How you'd actually use this

**(a) Sanity-check a large rule set during development, from a throwaway script.** Before shipping a config with 40+ rules, run it through `formatRuleTree()` and eyeball the cascade shape — this catches "wait, why does changing `country` touch 12 rules" long before it's a bug report:

```ts
// scripts/print-rule-tree.ts — run with `ts-node scripts/print-rule-tree.ts`
import { formatRuleTree } from 'rule-lite';
import { checkoutRules } from '../src/rules/checkout';

console.log(formatRuleTree(checkoutRules));
```

**(b) Feed the JSON into an admin/debug UI so non-developers can see what triggers what.** If rules are authored via a `fieldConfig`-driven form builder, a business user editing rules has no way to "run" them mentally. Hand `getRuleTree()`'s plain-object output to a tree-view component and they get a visual cascade instead of raw JSON:

```tsx
// RuleDebugPanel.tsx — a React admin panel, rendered next to the rule builder
import { getRuleTree } from 'rule-lite';

function RuleDebugPanel({ fieldConfig }: { fieldConfig: FieldConfigEntry[] }) {
  const tree = getRuleTree(fieldConfig); // pure/read-only — safe to recompute on every keystroke
  return (
    <TreeView
      roots={tree.roots}
      getLabel={(node) => `${node.ruleId} → ${node.writesFields.join(', ')}`}
      getChildren={(node) => node.children}
      warnings={tree.warnings} // surface cycles inline, e.g. as a red banner
    />
  );
}
```

**(c) Fail a build in CI or a pre-commit hook if a rule config has a cycle — before it ever reaches `compileFormRules()` at runtime.** `getRuleTree()`'s `warnings` array is exactly the same static cycle detection `compileFormRules()` runs, but you can check it as a standalone test/script step instead of waiting to catch a `RuleCascadeError` at evaluation time in production:

```ts
// test/rule-config.test.ts, or a pre-commit script
import { getRuleTree } from 'rule-lite';
import { productionRules } from '../src/rules/production';

test('production rule config has no circular dependencies', () => {
  const { warnings } = getRuleTree(productionRules);
  const cycles = warnings.filter((w) => w.includes('circular'));
  expect(cycles).toEqual([]); // fails the build with the exact cycle path if not
});
```

**(d) Paste `formatRuleTree()` output into a PR description as a code-review aid.** A reviewer looking at a diff that touches 3 rules out of 30 can't easily tell what else those rules cascade into just by reading the changed lines. Generate the text preview once and paste it into the PR body (or have CI post it as a comment) so the reviewer sees the shape without tracing every rule by hand:

```ts
// e.g. in a `pnpm rules:preview` script whose output you copy into the PR description
console.log('```\n' + formatRuleTree(loanFormRules) + '\n```');
```

## Angular Reactive Forms integration

The core engine has zero framework dependency, but a small duck-typed helper is included so you don't have to hand-roll the patch-application loop:

```ts
import { applyPatchToFormGroup } from 'rule-lite';

const { patch } = engine.evaluate(this.form.value, { changedFields: ['country'] });
applyPatchToFormGroup(this.form, patch, { isEven: (v) => v % 2 === 0 });
```

It sets values, rebuilds validators via `setValidators` + `updateValueAndValidity`, applies `disable()`/`enable()`, and merges `crossFieldErrors` into `setErrors()`. `options` and `visible` have no `FormControl` equivalent — read those two fields directly off the patch in your template (`*ngIf="patch.city?.visible"`, bind `[options]="patch.city?.options"`).

`applyPatchToFormGroup` is duck-typed against two exported interfaces rather than an `@angular/forms` import, so it works against a real `FormGroup`/`FormControl` without rule-lite depending on Angular at all — or against any object shaped like them (a test double, a different reactive-forms-alike):

```ts
interface FormControlLike {
  value: unknown;
  errors?: Record<string, unknown> | null;
  setValue(value: unknown, opts?: unknown): void;
  setValidators(fns: unknown): void;
  setErrors?(errors: Record<string, unknown> | null, opts?: unknown): void;
  updateValueAndValidity(opts?: unknown): void;
  disable(opts?: unknown): void;
  enable(opts?: unknown): void;
}

interface FormGroupLike {
  get(name: string): FormControlLike | null;
}
```

If you want the validator functions without the rest of `applyPatchToFormGroup` — e.g. to attach them to a control yourself, or to use outside Angular entirely — call `buildValidatorFns` directly. It turns a `ValidatorSpec` into an array of Angular-`ValidatorFn`-shaped functions (`(control) => ValidationErrors | null`), with no `@angular/forms` import required:

```ts
import { buildValidatorFns } from 'rule-lite';

const validatorFns = buildValidatorFns({ required: true, maxLength: 10 });
control.setValidators(validatorFns);
control.updateValueAndValidity();

// with a custom validator (same lookup `applyPatchToFormGroup` does internally):
buildValidatorFns({ custom: 'isEven' }, { isEven: (v) => v % 2 === 0 });
```

## Debugging: explain mode & errors

Pass `explain: true` to get a trace of every rule considered on every cascade pass:

```ts
const { trace } = engine.evaluate(formData, { changedFields: ['income'], explain: true });
// [{ pass: 1, ruleId: 'computeRiskTier', matched: true }, { pass: 1, ruleId: 'requireCoApplicant', matched: false }, ...]
```

`engine.evaluate()` always returns an `EvaluateResult` (exported), whether or not `explain` is set:

```ts
interface EvaluateResult {
  patch: Patch;
  trace?: TraceEntry[];   // only populated when explain: true
  passes: number;         // cascade passes to reach a fixpoint (1 in 'full' mode)
  warnings: string[];     // same static warnings as CompiledFormRuleSet.warnings, echoed per-call
}

interface TraceEntry {
  pass: number;
  ruleId: string;
  matched: boolean;       // whether the rule's `when` matched on this pass
}
```

All errors are typed and carry the failing rule id for fast debugging:

- `RuleConfigError` — thrown by `compileFormRules` for a malformed config (duplicate id, unknown action, malformed expression) — fails at compile time, never silently at runtime. Carries an optional `ruleId`.
- `RuleEvaluationError` — thrown during `evaluate()` if a rule's condition or action throws (e.g. an unknown expression function name); wraps the original error and includes `ruleId`/`actionIndex`/`causeError` (the original thrown error, for `console.error(err.causeError)` when you need the underlying stack).
- `RuleCascadeError` — thrown when `maxCascadeDepth` is exceeded; includes `involvedFields`/`involvedRules`.

`compileFormRules(config)` (and `compileFieldConfig()`, which returns the same shape) gives you a `CompiledFormRuleSet`: `{ config, warnings, evaluate(formData, options), getDependencyGraph() }`. `config` is the exact `FormRuleConfig` you passed in (or the flattened one, for `compileFieldConfig`) — handy if downstream code needs the raw config back, e.g. to feed into `getRuleTree()` alongside a compiled engine.

## Changelog

### 2.1.0 — 2026-09-30

- Fixed: `setValue`/`resetValue` `target` with a nested dot path (e.g. `address.city`) now nests correctly instead of failing to write into the nested object.
- Added: `{ object: {...} }` `ValueExpression` shape — compute and write a whole JSON sub-object from a single `setValue`.
- Added: `toNumber`, `toString`, `toBoolean` expression functions for coercing string-typed form values before math/logic.
- Added: `compileFieldConfig()` — a field-centric config authoring adapter, alongside `fieldConfigToFormRuleConfig()`.
- Added: `getRuleTree()` / `formatRuleTree()` — read-only dependency-graph inspection utilities for previewing a rule set.

## License

MIT
