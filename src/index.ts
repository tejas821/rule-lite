/**
 * rule-lite v2
 *
 * Everything from v1 (RuleEngine, evaluate, getByPath, types) is re-exported
 * unchanged for wire compatibility. v2 adds a form-action layer on top:
 * compileFormRules/getCompiledFormRules turn a FormRuleConfig into a pure
 * evaluator that produces a declarative Patch (value/validators/options/
 * visible/disabled) for driving dynamic forms.
 */
export * from './core';
export * from './expr';
export * from './form-types';
export * from './form-engine';
export * from './field-config';
export * from './rule-tree';
