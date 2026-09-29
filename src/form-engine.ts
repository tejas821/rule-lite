/**
 * rule-lite v2 — form-action engine.
 *
 * Compiles a FormRuleConfig into a reusable evaluator that turns form data
 * (plus optional addon data) into a declarative Patch describing what should
 * change: field values, validators, dropdown options, visibility, disabled
 * state. Pure functions in, plain data out — no UI framework knowledge.
 */
import { RuleEngine, getByPath, setByPath } from './core';
import type { EvaluationContext, Rule } from './types';
import { collectExpressionFields, collectRuleFields, defaultExprFns, evaluateExpression } from './expr';
import type { ValueExpression } from './expr';
import {
  RuleCascadeError,
  RuleConfigError,
  RuleEvaluationError,
} from './form-types';
import type {
  EnablementAction,
  EvaluateOptions,
  EvaluateResult,
  FieldAction,
  FieldRule,
  FormRuleConfig,
  Patch,
  TraceEntry,
  ValidatorSpec,
  VisibilityAction,
} from './form-types';

const DEFAULT_MAX_CASCADE_DEPTH = 50;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

// ----------------------------------------------------------------------------
// config validation — fail fast at compile time, never silently no-op at runtime
// ----------------------------------------------------------------------------

const KNOWN_ACTIONS = new Set([
  'setValue',
  'resetValue',
  'setValidation',
  'crossFieldValidation',
  'filterDropdown',
  'setOptions',
  'show',
  'hide',
  'enable',
  'disable',
]);

function validateExpressionShape(expr: unknown, ruleId: string, path: string): void {
  if (expr === null || typeof expr !== 'object') {
    throw new RuleConfigError(`malformed expression at ${path}: ${JSON.stringify(expr)}`, ruleId);
  }
  const e = expr as Record<string, unknown>;
  if ('const' in e) return;
  if ('field' in e) {
    if (typeof e.field !== 'string' || !e.field) {
      throw new RuleConfigError(`expression.field must be a non-empty string at ${path}`, ruleId);
    }
    return;
  }
  if ('if' in e) {
    if (!('then' in e) || !('else' in e)) {
      throw new RuleConfigError(`"if" expression missing "then"/"else" at ${path}`, ruleId);
    }
    validateExpressionShape(e.then, ruleId, `${path}.then`);
    validateExpressionShape(e.else, ruleId, `${path}.else`);
    return;
  }
  if ('fn' in e) {
    if (typeof e.fn !== 'string' || !e.fn) throw new RuleConfigError(`expression.fn must be a non-empty string at ${path}`, ruleId);
    if (!Array.isArray(e.args)) throw new RuleConfigError(`expression.args must be an array at ${path}`, ruleId);
    (e.args as unknown[]).forEach((a, i) => validateExpressionShape(a, ruleId, `${path}.args[${i}]`));
    return;
  }
  if ('object' in e) {
    if (!isPlainObject(e.object)) throw new RuleConfigError(`expression.object must be a plain object at ${path}`, ruleId);
    for (const [key, valueExpr] of Object.entries(e.object)) {
      validateExpressionShape(valueExpr, ruleId, `${path}.object.${key}`);
    }
    return;
  }
  throw new RuleConfigError(`unrecognized expression shape at ${path}: ${JSON.stringify(expr)}`, ruleId);
}

function validateConfig(config: FormRuleConfig): void {
  if (!config || !Array.isArray(config.rules)) {
    throw new RuleConfigError('config.rules must be an array');
  }
  const seenIds = new Set<string>();
  config.rules.forEach((rule, ruleIdx) => {
    if (!rule || typeof rule !== 'object') throw new RuleConfigError(`rules[${ruleIdx}] must be an object`);
    if (!rule.id || typeof rule.id !== 'string') throw new RuleConfigError(`rules[${ruleIdx}] needs a non-empty string "id"`);
    if (seenIds.has(rule.id)) throw new RuleConfigError(`duplicate rule id "${rule.id}"`);
    seenIds.add(rule.id);
    if (!rule.when) throw new RuleConfigError('rule.when is required', rule.id);
    if (!Array.isArray(rule.then) || rule.then.length === 0) {
      throw new RuleConfigError('rule.then must be a non-empty array of actions', rule.id);
    }
    rule.then.forEach((action, i) => {
      if (!action || typeof action !== 'object' || !KNOWN_ACTIONS.has((action as FieldAction).action)) {
        throw new RuleConfigError(`unknown or malformed action at then[${i}]: ${JSON.stringify(action)}`, rule.id);
      }
      const target = (action as { target?: unknown }).target;
      if (typeof target !== 'string' || !target) {
        throw new RuleConfigError(`action at then[${i}] is missing a non-empty "target"`, rule.id);
      }
      const a = action as FieldAction;
      switch (a.action) {
        case 'setValue':
          validateExpressionShape(a.value, rule.id, `then[${i}].value`);
          break;
        case 'resetValue':
          if (a.to) validateExpressionShape(a.to, rule.id, `then[${i}].to`);
          break;
        case 'filterDropdown':
          validateExpressionShape(a.source, rule.id, `then[${i}].source`);
          validateExpressionShape(a.matchValue, rule.id, `then[${i}].matchValue`);
          if (!a.matchKey || typeof a.matchKey !== 'string') {
            throw new RuleConfigError(`filterDropdown at then[${i}] requires a non-empty "matchKey"`, rule.id);
          }
          break;
        case 'setOptions':
          validateExpressionShape(a.options, rule.id, `then[${i}].options`);
          break;
        case 'crossFieldValidation':
          if (!a.otherField || typeof a.otherField !== 'string') {
            throw new RuleConfigError(`crossFieldValidation at then[${i}] requires a non-empty "otherField"`, rule.id);
          }
          break;
        case 'setValidation':
          if (!a.validators || typeof a.validators !== 'object') {
            throw new RuleConfigError(`setValidation at then[${i}] requires a "validators" object`, rule.id);
          }
          break;
        default:
          break;
      }
    });
  });
}

// ----------------------------------------------------------------------------
// dependency graph
// ----------------------------------------------------------------------------

interface DependencyGraph {
  /** field -> ids of rules whose `when` or action expressions read that field */
  fieldToRules: Map<string, Set<string>>;
  /** rules with zero field dependencies (e.g. `{ all: [] }`) — always candidates in 'full' mode */
  zeroDepRuleIds: Set<string>;
  ruleById: Map<string, FieldRule>;
  order: Map<string, number>;
}

/** Collects every field path an action's expressions read (its `value`/`source`/`matchValue`/`options`/`otherField`, as applicable). */
export function collectActionFields(action: FieldAction, out: Set<string>): void {
  switch (action.action) {
    case 'setValue':
      collectExpressionFields(action.value, out);
      break;
    case 'resetValue':
      if (action.to) collectExpressionFields(action.to, out);
      break;
    case 'filterDropdown':
      collectExpressionFields(action.source, out);
      collectExpressionFields(action.matchValue, out);
      break;
    case 'setOptions':
      collectExpressionFields(action.options, out);
      break;
    case 'crossFieldValidation':
      out.add(action.otherField);
      break;
    default:
      break;
  }
}

function buildDependencyGraph(config: FormRuleConfig): DependencyGraph {
  const fieldToRules = new Map<string, Set<string>>();
  const zeroDepRuleIds = new Set<string>();
  const ruleById = new Map<string, FieldRule>();
  const order = new Map<string, number>();

  config.rules.forEach((rule, idx) => {
    ruleById.set(rule.id, rule);
    order.set(rule.id, idx);

    const fields = new Set<string>();
    collectRuleFields(rule.when, fields);
    rule.then.forEach((action) => collectActionFields(action, fields));
    for (const f of rule.dependsOn ?? []) fields.add(f);

    if (fields.size === 0) {
      zeroDepRuleIds.add(rule.id);
    } else {
      for (const f of fields) {
        if (!fieldToRules.has(f)) fieldToRules.set(f, new Set());
        fieldToRules.get(f)!.add(rule.id);
      }
    }
  });

  return { fieldToRules, zeroDepRuleIds, ruleById, order };
}

function ruleTargets(rule: FieldRule): Set<string> {
  return new Set(rule.then.map((a) => a.target));
}

/** Static best-effort cycle detection at compile time — non-fatal, surfaced as warnings. */
function detectStaticCycles(graph: DependencyGraph): string[] {
  const edges = new Map<string, Set<string>>();
  for (const [id, rule] of graph.ruleById) {
    const dependents = new Set<string>();
    for (const t of ruleTargets(rule)) {
      for (const r of graph.fieldToRules.get(t) ?? []) if (r !== id) dependents.add(r);
    }
    edges.set(id, dependents);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const warnings: string[] = [];
  const seenCycles = new Set<string>();

  function dfs(id: string, path: string[]): void {
    if (visiting.has(id)) {
      const cycleStart = path.indexOf(id);
      const cycle = [...path.slice(cycleStart), id];
      const key = [...new Set(cycle)].sort().join(',');
      if (!seenCycles.has(key)) {
        seenCycles.add(key);
        warnings.push(`possible circular rule dependency: ${cycle.join(' -> ')}`);
      }
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of edges.get(id) ?? []) dfs(next, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  }

  for (const id of graph.ruleById.keys()) dfs(id, []);
  return warnings;
}

// ----------------------------------------------------------------------------
// validators
// ----------------------------------------------------------------------------

/** Returns Angular-ValidatorFn-shaped functions — (control) => ValidationErrors | null — with no @angular/forms import. */
export function buildValidatorFns(
  spec: ValidatorSpec,
  custom?: Record<string, (value: unknown, context: Record<string, unknown>) => boolean>
): Array<(control: { value: unknown }) => Record<string, unknown> | null> {
  const fns: Array<(control: { value: unknown }) => Record<string, unknown> | null> = [];
  if (spec.required) {
    fns.push((c) => (c.value === undefined || c.value === null || c.value === '' ? { required: true } : null));
  }
  if (spec.min !== undefined) {
    fns.push((c) => (typeof c.value === 'number' && c.value < spec.min! ? { min: { min: spec.min, actual: c.value } } : null));
  }
  if (spec.max !== undefined) {
    fns.push((c) => (typeof c.value === 'number' && c.value > spec.max! ? { max: { max: spec.max, actual: c.value } } : null));
  }
  if (spec.minLength !== undefined) {
    fns.push((c) =>
      typeof c.value === 'string' && c.value.length < spec.minLength!
        ? { minlength: { requiredLength: spec.minLength, actualLength: c.value.length } }
        : null
    );
  }
  if (spec.maxLength !== undefined) {
    fns.push((c) =>
      typeof c.value === 'string' && c.value.length > spec.maxLength!
        ? { maxlength: { requiredLength: spec.maxLength, actualLength: c.value.length } }
        : null
    );
  }
  if (spec.pattern !== undefined) {
    const re = new RegExp(spec.pattern);
    fns.push((c) => (typeof c.value === 'string' && !re.test(c.value) ? { pattern: { requiredPattern: spec.pattern } } : null));
  }
  if (spec.custom) {
    const fn = custom?.[spec.custom];
    fns.push((c) => (fn && !fn(c.value, {}) ? { [spec.custom!]: true } : null));
  }
  return fns;
}

// ----------------------------------------------------------------------------
// compiled engine
// ----------------------------------------------------------------------------

export interface CompiledFormRuleSet {
  config: FormRuleConfig;
  /** Non-fatal warnings from compile-time static analysis (e.g. possible cycles). */
  warnings: string[];
  evaluate(formData: EvaluationContext, options?: EvaluateOptions): EvaluateResult;
  getDependencyGraph(): { field: string; ruleIds: string[] }[];
}

export function compileFormRules(config: FormRuleConfig): CompiledFormRuleSet {
  validateConfig(config);
  const graph = buildDependencyGraph(config);
  const warnings = detectStaticCycles(graph);
  const ruleEngine = new RuleEngine();
  const evaluateRule = (rule: Rule, ctx: EvaluationContext) => ruleEngine.evaluate(rule, ctx);
  const compareOp = new RuleEngine();

  function applyAction(
    action: FieldAction,
    rule: FieldRule,
    currentState: EvaluationContext,
    patch: Patch,
    dirty: Set<string>,
    hideWon: Set<string>,
    disableWon: Set<string>,
    nextFrontier: Set<string>,
    options: EvaluateOptions
  ): void {
    const target = action.target;
    const ensureEntry = () => (patch[target] ??= {});

    switch (action.action) {
      case 'setValue': {
        if (dirty.has(target) && !action.force) return;
        const newValue = evaluateExpression(action.value, currentState, evaluateRule, { fns: options.fns });
        if (!deepEqual(getByPath(currentState, target), newValue)) {
          setByPath(currentState, target, newValue);
          ensureEntry().value = newValue;
          nextFrontier.add(target);
        }
        return;
      }
      case 'resetValue': {
        const newValue = action.to ? evaluateExpression(action.to, currentState, evaluateRule, { fns: options.fns }) : null;
        if (!deepEqual(getByPath(currentState, target), newValue)) {
          setByPath(currentState, target, newValue);
          ensureEntry().value = newValue;
          nextFrontier.add(target);
        }
        return;
      }
      case 'setValidation': {
        const entry = ensureEntry();
        entry.validators = { ...(entry.validators ?? {}), ...action.validators };
        return;
      }
      case 'crossFieldValidation': {
        const targetVal = getByPath(currentState, target);
        const otherVal = getByPath(currentState, action.otherField);
        const ok = compareOp.evaluate({ field: '__t', operator: action.compare, value: otherVal }, { __t: targetVal });
        if (!ok) {
          const entry = ensureEntry();
          entry.crossFieldErrors = {
            ...(entry.crossFieldErrors ?? {}),
            [rule.id]: action.message ?? `"${target}" failed cross-field check (${action.compare} "${action.otherField}")`,
          };
        }
        return;
      }
      case 'filterDropdown': {
        const source = evaluateExpression(action.source, currentState, evaluateRule, { fns: options.fns });
        const matchVal = evaluateExpression(action.matchValue, currentState, evaluateRule, { fns: options.fns });
        const list = Array.isArray(source) ? source : [];
        ensureEntry().options = list.filter(
          (opt) => isPlainObject(opt) && (opt as Record<string, unknown>)[action.matchKey] === matchVal
        );
        return;
      }
      case 'setOptions': {
        const opts = evaluateExpression(action.options, currentState, evaluateRule, { fns: options.fns });
        ensureEntry().options = Array.isArray(opts) ? opts : [];
        return;
      }
      case 'show':
      case 'hide': {
        const a = action as VisibilityAction;
        if (a.action === 'hide') hideWon.add(target);
        ensureEntry().visible = !hideWon.has(target);
        return;
      }
      case 'enable':
      case 'disable': {
        const a = action as EnablementAction;
        if (a.action === 'disable') disableWon.add(target);
        ensureEntry().disabled = disableWon.has(target);
        return;
      }
    }
  }

  function evaluateOnce(baseState: EvaluationContext, options: EvaluateOptions, seedFields: Set<string>, mode: 'cascade' | 'full'): EvaluateResult {
    const patch: Patch = {};
    const trace: TraceEntry[] = [];
    const dirty = new Set(options.dirtyFields ?? []);
    const maxDepth = options.maxCascadeDepth ?? DEFAULT_MAX_CASCADE_DEPTH;
    const hideWon = new Set<string>();
    const disableWon = new Set<string>();
    const currentState: EvaluationContext = { ...baseState };
    let frontier = new Set(seedFields);
    let pass = 0;
    let firstPass = true;
    const hasZeroDepRules = mode === 'full' && graph.zeroDepRuleIds.size > 0;

    while (frontier.size > 0 || (firstPass && hasZeroDepRules)) {
      pass++;
      if (pass > maxDepth) {
        const candidateIds = [...frontier].flatMap((f) => [...(graph.fieldToRules.get(f) ?? [])]);
        throw new RuleCascadeError(
          'maximum cascade depth exceeded — likely a circular rule dependency (two or more rules keep changing each other\'s fields)',
          [...frontier],
          [...new Set(candidateIds)]
        );
      }

      const candidateIds = new Set<string>();
      for (const f of frontier) for (const id of graph.fieldToRules.get(f) ?? []) candidateIds.add(id);
      if (mode === 'full' && firstPass) {
        for (const id of graph.zeroDepRuleIds) candidateIds.add(id);
      }
      firstPass = false;

      const fired: FieldRule[] = [];
      for (const id of candidateIds) {
        const rule = graph.ruleById.get(id);
        if (!rule || rule.enabled === false) continue;
        let matched = false;
        try {
          matched = evaluateRule(rule.when, currentState);
        } catch (err) {
          throw new RuleEvaluationError(`failed evaluating "when": ${(err as Error)?.message ?? err}`, id, undefined, err);
        }
        if (options.explain) trace.push({ pass, ruleId: id, matched });
        if (matched) fired.push(rule);
      }

      // Ascending priority, ties broken by ascending declaration order — so the LAST rule processed
      // (highest priority, or if tied, the one declared last) wins any same-target conflict via
      // straightforward "last write overwrites" semantics below.
      fired.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || graph.order.get(a.id)! - graph.order.get(b.id)!);

      const nextFrontier = new Set<string>();
      for (const rule of fired) {
        rule.then.forEach((action, actionIndex) => {
          try {
            applyAction(action, rule, currentState, patch, dirty, hideWon, disableWon, nextFrontier, options);
          } catch (err) {
            if (err instanceof RuleEvaluationError) throw err;
            throw new RuleEvaluationError((err as Error)?.message ?? String(err), rule.id, actionIndex, err);
          }
        });
      }

      frontier = nextFrontier;
    }

    return { patch, trace: options.explain ? trace : undefined, passes: pass, warnings };
  }

  return {
    config,
    warnings,
    evaluate(formData: EvaluationContext, options: EvaluateOptions = {}): EvaluateResult {
      const merged: EvaluationContext = { ...formData, ...(options.addonData ?? {}) };
      const mode: 'cascade' | 'full' = options.mode ?? (options.changedFields && options.changedFields.length > 0 ? 'cascade' : 'full');
      const seedFields = mode === 'full' ? new Set(graph.fieldToRules.keys()) : new Set(options.changedFields ?? []);
      return evaluateOnce(merged, options, seedFields, mode);
    },
    getDependencyGraph() {
      return [...graph.fieldToRules.entries()].map(([field, ruleIds]) => ({ field, ruleIds: [...ruleIds] }));
    },
  };
}

// ----------------------------------------------------------------------------
// compile cache — "compile once, evaluate many", cached by config object identity
// ----------------------------------------------------------------------------

const compileCache = new WeakMap<FormRuleConfig, CompiledFormRuleSet>();

/** Compiles a FormRuleConfig, caching the result by config object identity so repeated calls are free. */
export function getCompiledFormRules(config: FormRuleConfig): CompiledFormRuleSet {
  let compiled = compileCache.get(config);
  if (!compiled) {
    compiled = compileFormRules(config);
    compileCache.set(config, compiled);
  }
  return compiled;
}

// ----------------------------------------------------------------------------
// Angular Reactive Forms convenience (optional; core engine has zero UI coupling)
// ----------------------------------------------------------------------------

export interface FormControlLike {
  value: unknown;
  errors?: Record<string, unknown> | null;
  setValue(value: unknown, opts?: unknown): void;
  setValidators(fns: unknown): void;
  setErrors?(errors: Record<string, unknown> | null, opts?: unknown): void;
  updateValueAndValidity(opts?: unknown): void;
  disable(opts?: unknown): void;
  enable(opts?: unknown): void;
}

export interface FormGroupLike {
  get(name: string): FormControlLike | null;
}

/**
 * Applies a Patch to an Angular-Reactive-Forms-shaped FormGroup (duck-typed —
 * no @angular/forms import/dependency). `options` and `visible` have no
 * FormControl equivalent; read those two directly off the patch in your template.
 */
export function applyPatchToFormGroup(
  formGroup: FormGroupLike,
  patch: Patch,
  customValidators?: Record<string, (value: unknown, context: Record<string, unknown>) => boolean>
): void {
  for (const [name, entry] of Object.entries(patch)) {
    const control = formGroup.get(name);
    if (!control) continue;
    if ('value' in entry) control.setValue(entry.value, { emitEvent: false });
    if (entry.validators) {
      control.setValidators(buildValidatorFns(entry.validators, customValidators));
      control.updateValueAndValidity({ emitEvent: false });
    }
    if (entry.crossFieldErrors && Object.keys(entry.crossFieldErrors).length > 0 && control.setErrors) {
      control.setErrors({ ...(control.errors ?? {}), crossField: entry.crossFieldErrors });
    }
    if ('disabled' in entry) {
      if (entry.disabled) control.disable({ emitEvent: false });
      else control.enable({ emitEvent: false });
    }
  }
}
