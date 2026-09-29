import type { Rule } from './types';
import type { ExprFn, ValueExpression } from './expr';

export interface CrossFieldRule {
  compare: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
  otherField: string;
  message?: string;
}

export interface ValidatorSpec {
  required?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  /** Regex source string (not a RegExp instance, so it stays JSON-serializable). */
  pattern?: string;
  /** Name of a validator function registered via EvaluateOptions.customValidators. */
  custom?: string;
}

export interface SetValueAction {
  action: 'setValue';
  target: string;
  value: ValueExpression;
  /** If true, overwrite even if the user has already edited this field. Default false. */
  force?: boolean;
}

export interface ResetValueAction {
  action: 'resetValue';
  target: string;
  /** Defaults to null when omitted. Always applies, regardless of dirty state. */
  to?: ValueExpression;
}

export interface SetValidationAction {
  action: 'setValidation';
  target: string;
  validators: ValidatorSpec;
}

export interface CrossFieldValidationAction {
  action: 'crossFieldValidation';
  target: string;
  compare: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
  otherField: string;
  message?: string;
}

export interface FilterDropdownAction {
  action: 'filterDropdown';
  target: string;
  /** Expression resolving to the full array of option objects. */
  source: ValueExpression;
  /** Property name on each option object to filter by. */
  matchKey: string;
  /** Expression resolving to the value each option's [matchKey] must equal. */
  matchValue: ValueExpression;
}

export interface SetOptionsAction {
  action: 'setOptions';
  target: string;
  /** Expression resolving directly to the new full options array. */
  options: ValueExpression;
}

export type VisibilityAction = { action: 'show' | 'hide'; target: string };
export type EnablementAction = { action: 'enable' | 'disable'; target: string };

export type FieldAction =
  | SetValueAction
  | ResetValueAction
  | SetValidationAction
  | CrossFieldValidationAction
  | FilterDropdownAction
  | SetOptionsAction
  | VisibilityAction
  | EnablementAction;

export interface FieldRule {
  id: string;
  when: Rule;
  then: FieldAction[];
  /** Higher priority wins same-target conflicts (e.g. two setValue rules on one field). Default 0. */
  priority?: number;
  /** Set false to keep a rule in the config but skip it. Default true. */
  enabled?: boolean;
  /**
   * Extra field names this rule should be considered dependent on, beyond what's
   * automatically detected from `when`/`then`. Use this when a rule's `when` is
   * value-independent (e.g. `{ all: [] }`) but should still re-run whenever a
   * specific field changes to ANY value — including becoming null/undefined —
   * such as "clear the city whenever state changes, even if state was cleared".
   */
  dependsOn?: string[];
}

export interface FormRuleConfig {
  /** Optional declared field universe; purely documentary/for tooling, not required for evaluation. */
  fields?: string[];
  rules: FieldRule[];
}

export interface PatchEntry {
  value?: unknown;
  validators?: ValidatorSpec;
  /** Populated by crossFieldValidation failures: ruleId -> message. */
  crossFieldErrors?: Record<string, string>;
  options?: unknown[];
  visible?: boolean;
  disabled?: boolean;
}

export type Patch = Record<string, PatchEntry>;

export type EvaluationMode = 'cascade' | 'full';

export interface EvaluateOptions {
  /** 'full' evaluates every rule once; 'cascade' propagates from changedFields. Defaults based on changedFields. */
  mode?: EvaluationMode;
  /** Field(s) whose value just changed — seeds the cascade. Ignored in 'full' mode. */
  changedFields?: string[];
  /** Extra read-only data merged into the evaluation context alongside form data. */
  addonData?: Record<string, unknown>;
  /** Fields the user has manually edited; setValue (not resetValue) skips these unless the action sets force:true. */
  dirtyFields?: Iterable<string>;
  /** Safety cap on cascade passes before RuleCascadeError is thrown. Default 50. */
  maxCascadeDepth?: number;
  /** When true, returns a per-pass trace of which rules matched/skipped. */
  explain?: boolean;
  /** Extra/override functions available to `{ fn }` value expressions. */
  fns?: Record<string, ExprFn>;
  /** Named validator functions referenced by ValidatorSpec.custom. */
  customValidators?: Record<string, (value: unknown, context: Record<string, unknown>) => boolean>;
}

export interface TraceEntry {
  pass: number;
  ruleId: string;
  matched: boolean;
}

export interface EvaluateResult {
  patch: Patch;
  trace?: TraceEntry[];
  /** Number of cascade passes it took to reach a fixpoint. */
  passes: number;
  /** Non-fatal warnings surfaced at compile time (e.g. a statically detected possible cycle). */
  warnings: string[];
}

export class RuleConfigError extends Error {
  ruleId?: string;
  constructor(message: string, ruleId?: string) {
    super(`rule-lite: invalid config${ruleId ? ` (rule "${ruleId}")` : ''}: ${message}`);
    this.name = 'RuleConfigError';
    this.ruleId = ruleId;
  }
}

export class RuleCascadeError extends Error {
  involvedFields: string[];
  involvedRules: string[];
  constructor(message: string, involvedFields: string[], involvedRules: string[]) {
    super(`rule-lite: ${message} (fields still changing: ${involvedFields.join(', ') || '(none)'}; candidate rules: ${involvedRules.join(', ') || '(none)'})`);
    this.name = 'RuleCascadeError';
    this.involvedFields = involvedFields;
    this.involvedRules = involvedRules;
  }
}

export class RuleEvaluationError extends Error {
  ruleId: string;
  actionIndex?: number;
  causeError?: unknown;
  constructor(message: string, ruleId: string, actionIndex?: number, cause?: unknown) {
    super(`rule-lite: error evaluating rule "${ruleId}"${actionIndex !== undefined ? ` (then[${actionIndex}])` : ''}: ${message}`);
    this.name = 'RuleEvaluationError';
    this.ruleId = ruleId;
    this.actionIndex = actionIndex;
    this.causeError = cause;
  }
}
