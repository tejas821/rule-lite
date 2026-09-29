/**
 * fieldConfig adapter — a field-centric authoring convenience layered on top of the
 * existing rule-lite v2 engine. No changes to the engine itself: this module only
 * transforms a "one entry per field, rules embedded on the field" config shape into
 * the engine's native flat FormRuleConfig, then compiles it exactly the way
 * compileFormRules() always has.
 *
 * Motivation: some teams model a dynamic form as an array of field descriptors
 * (label, type, validation, options, ...) rather than a flat rule list decoupled
 * from field definitions. This lets that array carry its own `rules` alongside the
 * rest of each field's metadata, using the field's own key (`jsonattribute`) as the
 * implicit target for every rule declared on it.
 */
import { compileFormRules } from './form-engine';
import type { CompiledFormRuleSet } from './form-engine';
import { RuleConfigError } from './form-types';
import type { FieldAction, FieldRule, FormRuleConfig } from './form-types';
import type { Rule } from './types';

/**
 * One rule declared inline on a field. Shaped like a FieldAction minus `target`
 * (which defaults to the field's own `jsonattribute`) plus the `when` condition
 * and the same optional FieldRule-level knobs (`id`, `priority`, `enabled`,
 * `dependsOn`). Set `target` explicitly only when a rule declared on one field
 * needs to act on a *different* field (e.g. field A's value clears field B).
 */
export interface FieldConfigRule {
  when: Rule;
  action: FieldAction['action'];
  /** Defaults to an auto-generated, stable id (`${jsonattribute}__${action}__${index}`). */
  id?: string;
  /** Defaults to this field's `jsonattribute`. Override to act on a different field. */
  target?: string;
  priority?: number;
  enabled?: boolean;
  dependsOn?: string[];
  /** Everything else (value/to/validators/compare/otherField/message/source/matchKey/matchValue/options) is action-specific and passed through as-is. */
  [extra: string]: unknown;
}

/**
 * One field's config entry. `jsonattribute` is the field's key in the final output
 * JSON (and the default rule target); every other property is caller-defined
 * metadata (label, type, defaultValue, ...) that rule-lite ignores and simply
 * leaves untouched — useful for keeping one array as the single source of truth
 * for both rendering and rule authoring.
 */
export interface FieldConfigEntry {
  jsonattribute: string;
  rules?: FieldConfigRule[];
  [meta: string]: unknown;
}

function toFieldRule(field: FieldConfigEntry, fieldIdx: number, rule: FieldConfigRule, ruleIdx: number): FieldRule {
  const { when, action, id, target, priority, enabled, dependsOn, ...rest } = rule;
  if (!field.jsonattribute || typeof field.jsonattribute !== 'string') {
    throw new RuleConfigError(`fieldConfig[${fieldIdx}] is missing a non-empty "jsonattribute"`);
  }
  if (!when) {
    throw new RuleConfigError(`fieldConfig[${fieldIdx}].rules[${ruleIdx}] is missing "when"`, id);
  }
  if (!action) {
    throw new RuleConfigError(`fieldConfig[${fieldIdx}].rules[${ruleIdx}] is missing "action"`, id);
  }
  const resolvedTarget = target ?? field.jsonattribute;
  return {
    id: id ?? `${field.jsonattribute}__${action}__${ruleIdx}`,
    when,
    priority,
    enabled,
    dependsOn,
    then: [{ action, target: resolvedTarget, ...rest } as FieldAction],
  };
}

/** Converts a field-centric fieldConfig array into the engine's native FormRuleConfig, without compiling it. */
export function fieldConfigToFormRuleConfig(fieldConfig: FieldConfigEntry[]): FormRuleConfig {
  if (!Array.isArray(fieldConfig)) {
    throw new RuleConfigError('fieldConfig must be an array');
  }
  const rules: FieldRule[] = [];
  const fields: string[] = [];
  fieldConfig.forEach((field, fieldIdx) => {
    if (!field || typeof field !== 'object') {
      throw new RuleConfigError(`fieldConfig[${fieldIdx}] must be an object`);
    }
    fields.push(field.jsonattribute);
    (field.rules ?? []).forEach((rule, ruleIdx) => {
      rules.push(toFieldRule(field, fieldIdx, rule, ruleIdx));
    });
  });
  return { fields, rules };
}

/**
 * Compiles a field-centric fieldConfig array directly into a CompiledFormRuleSet —
 * the field-config equivalent of compileFormRules(). Every rule declared under a
 * field's `rules` array targets that field's `jsonattribute` by default; the
 * resulting evaluator, patch shape, cascade behavior, cycle protection and
 * conflict-resolution semantics are all identical to compileFormRules(), since
 * this is purely a config transform layered on top of it.
 */
export function compileFieldConfig(fieldConfig: FieldConfigEntry[]): CompiledFormRuleSet {
  return compileFormRules(fieldConfigToFormRuleConfig(fieldConfig));
}
