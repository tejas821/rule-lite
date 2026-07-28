/**
 * rule-lite — type definitions
 *
 * A "Rule" is either:
 *  - a leaf Condition (field + operator + value), evaluated against a context object
 *  - a composite of other Rules combined with all / any / not
 */

export type Operator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'notIn'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'exists'
  | 'notExists'
  | 'truthy'
  | 'falsy';

/** A leaf condition, e.g. { field: "age", operator: "gte", value: 18 } */
export interface Condition {
  /** Dot-path into the context object, e.g. "user.address.country" */
  field: string;
  operator: Operator | (string & {});
  /** Not required for unary operators like exists/truthy/falsy */
  value?: unknown;
}

export interface AllRule {
  all: Rule[];
}

export interface AnyRule {
  any: Rule[];
}

export interface NotRule {
  not: Rule;
}

export type Rule = Condition | AllRule | AnyRule | NotRule;

/** Arbitrary JSON-like object the rule is evaluated against. */
export type EvaluationContext = Record<string, unknown>;

/** Custom operator implementation: (fieldValue, ruleValue, context) => boolean */
export type OperatorFn = (
  fieldValue: unknown,
  ruleValue: unknown,
  context: EvaluationContext
) => boolean;
