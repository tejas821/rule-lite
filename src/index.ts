import type {
  AllRule,
  AnyRule,
  Condition,
  EvaluationContext,
  NotRule,
  OperatorFn,
  Rule,
} from './types';

export * from './types';

function isAllRule(rule: Rule): rule is AllRule {
  return typeof rule === 'object' && rule !== null && 'all' in rule;
}

function isAnyRule(rule: Rule): rule is AnyRule {
  return typeof rule === 'object' && rule !== null && 'any' in rule;
}

function isNotRule(rule: Rule): rule is NotRule {
  return typeof rule === 'object' && rule !== null && 'not' in rule;
}

/** Resolve a dot-path ("a.b.c") against a plain object. Returns undefined if any segment is missing. */
export function getByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

const defaultOperators: Record<string, OperatorFn> = {
  eq: (a, b) => a === b,
  neq: (a, b) => a !== b,
  gt: (a, b) => (a as number) > (b as number),
  gte: (a, b) => (a as number) >= (b as number),
  lt: (a, b) => (a as number) < (b as number),
  lte: (a, b) => (a as number) <= (b as number),
  in: (a, b) => Array.isArray(b) && b.includes(a),
  notIn: (a, b) => Array.isArray(b) && !b.includes(a),
  contains: (a, b) => {
    if (Array.isArray(a)) return a.includes(b);
    if (typeof a === 'string') return a.includes(String(b));
    return false;
  },
  startsWith: (a, b) => typeof a === 'string' && a.startsWith(String(b)),
  endsWith: (a, b) => typeof a === 'string' && a.endsWith(String(b)),
  exists: (a) => a !== undefined && a !== null,
  notExists: (a) => a === undefined || a === null,
  truthy: (a) => Boolean(a),
  falsy: (a) => !a,
};

export interface RuleEngineOptions {
  /** Extra/override operators, merged on top of the built-in set. */
  operators?: Record<string, OperatorFn>;
}

/**
 * RuleEngine evaluates JSON-defined Rule trees against a plain-object context.
 * Zero dependencies, framework-agnostic — usable from Angular, React, Node, etc.
 */
export class RuleEngine {
  private operators: Record<string, OperatorFn>;

  constructor(options: RuleEngineOptions = {}) {
    this.operators = { ...defaultOperators, ...(options.operators ?? {}) };
  }

  /** Register or override a single operator after construction. */
  registerOperator(name: string, fn: OperatorFn): void {
    this.operators[name] = fn;
  }

  evaluate(rule: Rule, context: EvaluationContext = {}): boolean {
    if (isAllRule(rule)) {
      return rule.all.every((r) => this.evaluate(r, context));
    }
    if (isAnyRule(rule)) {
      return rule.any.some((r) => this.evaluate(r, context));
    }
    if (isNotRule(rule)) {
      return !this.evaluate(rule.not, context);
    }
    return this.evaluateCondition(rule as Condition, context);
  }

  private evaluateCondition(condition: Condition, context: EvaluationContext): boolean {
    const { field, operator, value } = condition;
    const fn = this.operators[operator as string];
    if (!fn) {
      throw new Error(`rule-lite: unknown operator "${String(operator)}"`);
    }
    const fieldValue = getByPath(context, field);
    return fn(fieldValue, value, context);
  }
}

/** Convenience one-off evaluation without instantiating a RuleEngine. */
export function evaluate(
  rule: Rule,
  context: EvaluationContext = {},
  options?: RuleEngineOptions
): boolean {
  return new RuleEngine(options).evaluate(rule, context);
}
