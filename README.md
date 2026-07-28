# rule-lite

Tiny, dependency-free TypeScript engine for evaluating **JSON-defined conditional rules** — built for dynamic forms, feature flags, and business rules in enterprise apps.

[![CI](https://github.com/tejas821/rule-lite/actions/workflows/ci.yml/badge.svg)](https://github.com/tejas821/rule-lite/actions/workflows/ci.yml)
![npm](https://img.shields.io/badge/dependencies-zero-brightgreen)
![license](https://img.shields.io/badge/license-MIT-blue)

Framework-agnostic — drop it into Angular, React, Node, or plain JS. No runtime dependencies, ~1KB gzipped.

## Why

Enterprise apps constantly need to answer "should this field/section/feature be visible, given this data?" — dynamic forms, entitlement checks, feature flags, workflow branching. The logic is usually hand-rolled per feature and hard to serialize, test, or hand off to non-engineers (product/config-driven teams).

`rule-lite` gives you a small, serializable rule format that:

- lives entirely in JSON (storable in a DB, a CMS, or a config file)
- supports `AND` / `OR` / `NOT` composition with unlimited nesting
- ships common comparison operators, and lets you register your own
- has zero dependencies and a tiny surface area

## Install

```bash
npm install rule-lite
```

## Quick start

```ts
import { RuleEngine } from 'rule-lite';

const engine = new RuleEngine();

const rule = {
  all: [
    { field: 'user.age', operator: 'gte', value: 18 },
    {
      any: [
        { field: 'user.country', operator: 'eq', value: 'IN' },
        { field: 'user.role', operator: 'eq', value: 'admin' },
      ],
    },
  ],
};

engine.evaluate(rule, {
  user: { age: 25, country: 'IN', role: 'guest' },
}); // true
```

### One-off evaluation (no need to instantiate)

```ts
import { evaluate } from 'rule-lite';

evaluate({ field: 'status', operator: 'eq', value: 'active' }, { status: 'active' }); // true
```

## Rule shape

```ts
type Rule = Condition | { all: Rule[] } | { any: Rule[] } | { not: Rule };

interface Condition {
  field: string;        // dot-path into the context, e.g. "user.address.country"
  operator: string;     // see built-in operators below, or your own
  value?: unknown;      // omitted for unary operators (exists, truthy, ...)
}
```

## Built-in operators

| Operator | Description |
|---|---|
| `eq` / `neq` | equality / inequality |
| `gt` / `gte` / `lt` / `lte` | numeric comparison |
| `in` / `notIn` | value is/isn't in an array |
| `contains` | string substring or array membership |
| `startsWith` / `endsWith` | string prefix/suffix |
| `exists` / `notExists` | field is/isn't `null`/`undefined` |
| `truthy` / `falsy` | JS truthiness |

## Custom operators

```ts
const engine = new RuleEngine({
  operators: {
    divisibleBy: (fieldValue, ruleValue) => fieldValue % ruleValue === 0,
  },
});

engine.evaluate({ field: 'n', operator: 'divisibleBy', value: 5 }, { n: 25 }); // true
```

Or register after construction:

```ts
engine.registerOperator('isEven', (value) => value % 2 === 0);
```

## Use with Angular

`rule-lite` has no framework dependency, so it drops straight into a service:

```ts
@Injectable({ providedIn: 'root' })
export class VisibilityService {
  private engine = new RuleEngine();

  isVisible(rule: Rule, formValue: Record<string, unknown>): boolean {
    return this.engine.evaluate(rule, formValue);
  }
}
```

Pair it with `formGroup.valueChanges` (or an Angular Signal derived from it) to drive field-level `*ngIf` / `hidden` bindings from a JSON config instead of hand-written template conditionals.

## Design notes

See [CASE_STUDY.md](./CASE_STUDY.md) for the reasoning behind the API shape and trade-offs considered.

## Development

```bash
npm install
npm test
npm run build
```

## License

MIT © Tejas Kadam
