/**
 * Rule tree preview — a read-only inspection utility, no runtime evaluation involved.
 *
 * Takes any rule-lite v2 config — a flat FormRuleConfig or a field-centric
 * fieldConfig array (see field-config.ts) — and builds a navigable dependency
 * tree: for every rule, which fields it reads (its trigger inputs) and writes
 * (its outputs), and which other rules become candidates to fire next because
 * they read one of those written fields. This is exactly the cascade-propagation
 * relationship compileFormRules() uses internally, surfaced as plain JSON so it
 * can be rendered in a debugger, an admin UI, or just printed for a quick sanity
 * check while authoring a large rule set.
 *
 * Pure and side-effect-free: building a tree never evaluates a `when` condition
 * or a value expression, and accepts the exact same config you'd hand to
 * compileFormRules()/compileFieldConfig() — nothing extra to author.
 */
import { collectRuleFields } from './expr';
import { collectActionFields } from './form-engine';
import { fieldConfigToFormRuleConfig } from './field-config';
import type { FieldConfigEntry } from './field-config';
import type { FieldAction, FieldRule, FormRuleConfig } from './form-types';
import type { Rule } from './types';

export interface RuleTreeActionSummary {
  action: FieldAction['action'];
  target: string;
}

export interface RuleTreeNode {
  ruleId: string;
  when: Rule;
  priority: number;
  enabled: boolean;
  /** Field paths this rule's `when` + action expressions read — its trigger inputs. */
  readsFields: string[];
  /** Field paths this rule's actions write — its outputs. */
  writesFields: string[];
  actions: RuleTreeActionSummary[];
  /** Rules that read one of this rule's writesFields — i.e. what this rule can cascade into next. */
  children: RuleTreeNode[];
  /** True when expanding further would revisit a rule already on this path; children stop here instead of looping forever. */
  cyclic?: boolean;
}

export interface RuleTreeResult {
  /** Rules nothing else feeds into — the cascade's natural entry points (includes zero-dependency rules). */
  roots: RuleTreeNode[];
  /** Every rule as a node, flat, keyed by rule id. A rule reachable from multiple parents appears once here and once per parent in `children` — read this map, not object identity, if you need "the" node for a rule id. */
  nodesById: Record<string, RuleTreeNode>;
  /** field -> ids of rules that read it — the same mapping the evaluator uses to seed cascades. */
  fieldToRuleIds: Record<string, string[]>;
  /** Non-fatal notices, e.g. a cycle detected while walking the tree. */
  warnings: string[];
}

function isFieldConfigArray(input: FormRuleConfig | FieldConfigEntry[]): input is FieldConfigEntry[] {
  return Array.isArray(input);
}

function actionFields(action: FieldAction): Set<string> {
  const out = new Set<string>();
  collectActionFields(action, out);
  return out;
}

/**
 * Builds a RuleTreeResult from either a flat FormRuleConfig or a field-centric
 * fieldConfig array. Never throws on a cyclic rule graph — cycles are marked
 * `cyclic: true` on the node where the loop closes and reported in `warnings`,
 * so a rule set that would legitimately throw RuleCascadeError at evaluation
 * time can still be previewed safely here.
 */
export function getRuleTree(input: FormRuleConfig | FieldConfigEntry[]): RuleTreeResult {
  const config: FormRuleConfig = isFieldConfigArray(input) ? fieldConfigToFormRuleConfig(input) : input;
  const rules: FieldRule[] = Array.isArray(config?.rules) ? config.rules : [];

  const readsByRule = new Map<string, Set<string>>();
  const writesByRule = new Map<string, Set<string>>();
  const ruleById = new Map<string, FieldRule>();
  const fieldToRuleIds = new Map<string, Set<string>>();

  for (const rule of rules) {
    ruleById.set(rule.id, rule);

    const reads = new Set<string>();
    collectRuleFields(rule.when, reads);
    for (const action of rule.then ?? []) actionFields(action).forEach((f) => reads.add(f));
    for (const f of rule.dependsOn ?? []) reads.add(f);
    readsByRule.set(rule.id, reads);

    const writes = new Set((rule.then ?? []).map((a) => a.target));
    writesByRule.set(rule.id, writes);

    for (const f of reads) {
      if (!fieldToRuleIds.has(f)) fieldToRuleIds.set(f, new Set());
      fieldToRuleIds.get(f)!.add(rule.id);
    }
  }

  // edge A -> B when some field A writes is read by B (A's output can trigger B next pass)
  const childrenOf = new Map<string, Set<string>>();
  const hasIncoming = new Set<string>();
  for (const rule of rules) {
    const children = new Set<string>();
    for (const written of writesByRule.get(rule.id) ?? []) {
      for (const candidateId of fieldToRuleIds.get(written) ?? []) {
        if (candidateId !== rule.id) {
          children.add(candidateId);
          hasIncoming.add(candidateId);
        }
      }
    }
    childrenOf.set(rule.id, children);
  }

  const warnings: string[] = [];
  const nodesById: Record<string, RuleTreeNode> = {};

  function buildNode(ruleId: string, pathVisiting: Set<string>): RuleTreeNode {
    const rule = ruleById.get(ruleId)!;
    const node: RuleTreeNode = {
      ruleId,
      when: rule.when,
      priority: rule.priority ?? 0,
      enabled: rule.enabled !== false,
      readsFields: [...(readsByRule.get(ruleId) ?? [])],
      writesFields: [...(writesByRule.get(ruleId) ?? [])],
      actions: (rule.then ?? []).map((a) => ({ action: a.action, target: a.target })),
      children: [],
    };
    nodesById[ruleId] = node;

    const nextVisiting = new Set(pathVisiting).add(ruleId);
    for (const childId of childrenOf.get(ruleId) ?? []) {
      if (pathVisiting.has(childId)) {
        warnings.push(`possible circular rule dependency: ${[...pathVisiting].join(' -> ')} -> ${childId}`);
        node.children.push({
          ruleId: childId,
          when: ruleById.get(childId)!.when,
          priority: ruleById.get(childId)!.priority ?? 0,
          enabled: ruleById.get(childId)!.enabled !== false,
          readsFields: [...(readsByRule.get(childId) ?? [])],
          writesFields: [...(writesByRule.get(childId) ?? [])],
          actions: (ruleById.get(childId)!.then ?? []).map((a) => ({ action: a.action, target: a.target })),
          children: [],
          cyclic: true,
        });
        continue;
      }
      node.children.push(buildNode(childId, nextVisiting));
    }
    return node;
  }

  const roots: RuleTreeNode[] = [];
  for (const rule of rules) {
    if (!hasIncoming.has(rule.id)) {
      roots.push(buildNode(rule.id, new Set()));
    }
  }
  // Safety net: a rule graph made entirely of cycles (no field ever read that isn't also
  // written by another rule in the same loop) would otherwise never appear anywhere above.
  for (const rule of rules) {
    if (!(rule.id in nodesById)) {
      roots.push(buildNode(rule.id, new Set()));
    }
  }

  const fieldToRuleIdsOut: Record<string, string[]> = {};
  for (const [field, ids] of fieldToRuleIds) fieldToRuleIdsOut[field] = [...ids];

  return { roots, nodesById, fieldToRuleIds: fieldToRuleIdsOut, warnings };
}

/**
 * Renders a RuleTreeResult (or a config, built into a tree first) as an indented
 * text preview — handy for a quick console/log look without wiring up a UI.
 * Example line: `setCity  writes: address.city  (cyclic ref)`.
 */
export function formatRuleTree(input: RuleTreeResult | FormRuleConfig | FieldConfigEntry[]): string {
  const tree: RuleTreeResult = 'roots' in (input as RuleTreeResult) && 'nodesById' in (input as RuleTreeResult)
    ? (input as RuleTreeResult)
    : getRuleTree(input as FormRuleConfig | FieldConfigEntry[]);

  const lines: string[] = [];
  function render(node: RuleTreeNode, prefix: string, isLast: boolean): void {
    const connector = prefix === '' ? '' : isLast ? '└─ ' : '├─ ';
    const writes = node.writesFields.join(', ') || '(none)';
    const flags = [node.enabled ? null : 'disabled', node.cyclic ? 'cyclic ref' : null].filter(Boolean).join(', ');
    lines.push(`${prefix}${connector}${node.ruleId}  writes: ${writes}${flags ? `  (${flags})` : ''}`);
    if (node.cyclic) return;
    const childPrefix = prefix === '' ? '' : prefix + (isLast ? '   ' : '│  ');
    node.children.forEach((child, i) => render(child, childPrefix, i === node.children.length - 1));
  }
  tree.roots.forEach((root, i) => render(root, '', i === tree.roots.length - 1));
  if (tree.warnings.length > 0) {
    lines.push('', ...tree.warnings.map((w) => `⚠ ${w}`));
  }
  return lines.join('\n');
}
