/**
 * ValueExpression — a small, safe, JSON-only value-computation grammar for rule-lite v2.
 *
 * Deliberately NOT string-based (no eval/new Function anywhere). Every expression is a
 * plain object tree, evaluated by walking it and looking functions up in a whitelisted
 * registry — the same "structured JSON, no code execution" philosophy as v1's Rule type.
 */
import type { AllRule, AnyRule, Condition, EvaluationContext, NotRule, Rule } from './types';
import { getByPath } from './core';

export type ValueExpression =
  | { const: unknown }
  | { field: string }
  | { fn: string; args: ValueExpression[] }
  | { if: Rule; then: ValueExpression; else: ValueExpression }
  | { object: Record<string, ValueExpression> };

export type RuleEvaluator = (rule: Rule, context: EvaluationContext) => boolean;

export type ExprFn = (...args: unknown[]) => unknown;

export const defaultExprFns: Record<string, ExprFn> = {
  add: (...args) => (args as number[]).reduce((a, b) => a + b, 0),
  sub: (a, b) => (a as number) - (b as number),
  mul: (...args) => (args as number[]).reduce((a, b) => a * b, 1),
  div: (a, b) => (a as number) / (b as number),
  mod: (a, b) => (a as number) % (b as number),
  concat: (...args) => args.map((a) => (a === undefined || a === null ? '' : String(a))).join(''),
  coalesce: (...args) => args.find((a) => a !== undefined && a !== null),
  min: (...args) => Math.min(...(args as number[])),
  max: (...args) => Math.max(...(args as number[])),
  round: (a, digits) => {
    const d = Math.pow(10, (digits as number) ?? 0);
    return Math.round((a as number) * d) / d;
  },
  len: (a) => (a == null ? 0 : (a as { length: number }).length),
  upper: (a) => String(a ?? '').toUpperCase(),
  lower: (a) => String(a ?? '').toLowerCase(),
  // Coercion — useful when a value arrives from a form control as a string (e.g. a text
  // input bound to a numeric field) and needs to participate in numeric/string/boolean logic.
  toNumber: (a: unknown) => {
    if (typeof a === 'number') return a;
    if (a === null || a === undefined || a === '') return null;
    const n = Number(a);
    return Number.isNaN(n) ? null : n;
  },
  toString: (a: unknown) => (a === null || a === undefined ? '' : String(a)),
  toBoolean: (a: unknown) => {
    if (typeof a === 'boolean') return a;
    if (typeof a === 'string') return !['', '0', 'false', 'no'].includes(a.trim().toLowerCase());
    return Boolean(a);
  },
};

export interface ExprOptions {
  fns?: Record<string, ExprFn>;
}

export function evaluateExpression(
  expr: ValueExpression,
  context: EvaluationContext,
  evaluateRule: RuleEvaluator,
  options: ExprOptions = {}
): unknown {
  if (expr === null || typeof expr !== 'object') {
    throw new Error(`rule-lite: malformed value expression: ${JSON.stringify(expr)}`);
  }
  if ('const' in expr) return expr.const;
  if ('field' in expr) return getByPath(context, expr.field);
  if ('if' in expr) {
    return evaluateRule(expr.if, context)
      ? evaluateExpression(expr.then, context, evaluateRule, options)
      : evaluateExpression(expr.else, context, evaluateRule, options);
  }
  if ('fn' in expr) {
    const fns = { ...defaultExprFns, ...(options.fns ?? {}) };
    const fn = fns[expr.fn];
    if (!fn) throw new Error(`rule-lite: unknown expression function "${expr.fn}"`);
    const args = expr.args.map((a) => evaluateExpression(a, context, evaluateRule, options));
    return fn(...args);
  }
  if ('object' in expr) {
    const out: Record<string, unknown> = {};
    for (const [key, valueExpr] of Object.entries(expr.object)) {
      out[key] = evaluateExpression(valueExpr, context, evaluateRule, options);
    }
    return out;
  }
  throw new Error(`rule-lite: malformed value expression: ${JSON.stringify(expr)}`);
}

/** Collects every field path a Rule reads (recursing all/any/not) — used to build dependency graphs. */
export function collectRuleFields(rule: Rule, out: Set<string> = new Set()): Set<string> {
  if (typeof rule !== 'object' || rule === null) return out;
  if ('all' in rule) {
    (rule as AllRule).all.forEach((r) => collectRuleFields(r, out));
    return out;
  }
  if ('any' in rule) {
    (rule as AnyRule).any.forEach((r) => collectRuleFields(r, out));
    return out;
  }
  if ('not' in rule) {
    collectRuleFields((rule as NotRule).not, out);
    return out;
  }
  const field = (rule as Condition).field;
  if (field) out.add(field);
  return out;
}

/** Collects every field path a ValueExpression reads — used to build dependency graphs. */
export function collectExpressionFields(expr: ValueExpression, out: Set<string> = new Set()): Set<string> {
  if (expr === null || typeof expr !== 'object') return out;
  if ('const' in expr) return out;
  if ('field' in expr) {
    out.add(expr.field);
    return out;
  }
  if ('if' in expr) {
    collectRuleFields(expr.if, out);
    collectExpressionFields(expr.then, out);
    collectExpressionFields(expr.else, out);
    return out;
  }
  if ('fn' in expr) {
    for (const a of expr.args) collectExpressionFields(a, out);
    return out;
  }
  if ('object' in expr) {
    for (const valueExpr of Object.values(expr.object)) collectExpressionFields(valueExpr, out);
    return out;
  }
  return out;
}
