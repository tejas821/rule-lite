import {
  getRuleTree,
  formatRuleTree,
  FormRuleConfig,
  FieldConfigEntry,
  RuleTreeResult,
} from '../src/index';

// ---------------------------------------------------------------------------
// basic parent/child relationship
// ---------------------------------------------------------------------------

describe('getRuleTree - basic dependency relationship', () => {
  const config: FormRuleConfig = {
    rules: [
      {
        id: 'setCity',
        when: { field: 'address.zip', operator: 'exists' },
        then: [{ action: 'setValue', target: 'address.city', value: { const: 'Springfield' } }],
      },
      {
        id: 'validateCity',
        when: { field: 'address.city', operator: 'neq', value: '' },
        then: [{ action: 'setValidation', target: 'address.city', validators: { required: true } }],
      },
    ],
  };

  it('makes the writer a root and the reader its child', () => {
    const tree = getRuleTree(config);
    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0].ruleId).toBe('setCity');
    expect(tree.roots[0].children).toHaveLength(1);
    expect(tree.roots[0].children[0].ruleId).toBe('validateCity');
  });

  it('records readsFields and writesFields correctly on each node', () => {
    const tree = getRuleTree(config);
    const setCity = tree.nodesById['setCity'];
    const validateCity = tree.nodesById['validateCity'];
    expect(setCity.readsFields).toEqual(expect.arrayContaining(['address.zip']));
    expect(setCity.writesFields).toEqual(['address.city']);
    expect(validateCity.readsFields).toEqual(expect.arrayContaining(['address.city']));
  });

  it('summarizes actions on the node', () => {
    const tree = getRuleTree(config);
    expect(tree.nodesById['setCity'].actions).toEqual([{ action: 'setValue', target: 'address.city' }]);
  });
});

// ---------------------------------------------------------------------------
// zero-dependency rule
// ---------------------------------------------------------------------------

describe('getRuleTree - zero-dependency rule', () => {
  it('a rule with when: { all: [] } and no dependsOn is its own root with no incoming edges', () => {
    const config: FormRuleConfig = {
      rules: [
        {
          id: 'alwaysSetTotal',
          when: { all: [] },
          then: [{ action: 'setValue', target: 'total', value: { const: 0 } }],
        },
      ],
    };
    const tree = getRuleTree(config);
    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0].ruleId).toBe('alwaysSetTotal');
    expect(tree.roots[0].children).toHaveLength(0);
    expect(tree.roots[0].readsFields).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// fieldToRuleIds
// ---------------------------------------------------------------------------

describe('getRuleTree - fieldToRuleIds', () => {
  it('maps each read field to every rule id that reads it', () => {
    const config: FormRuleConfig = {
      rules: [
        {
          id: 'ruleA',
          when: { field: 'income', operator: 'gt', value: 500000 },
          then: [{ action: 'setValue', target: 'riskTier', value: { const: 'high' } }],
        },
        {
          id: 'ruleB',
          when: { field: 'income', operator: 'lte', value: 500000 },
          then: [{ action: 'setValue', target: 'riskTier', value: { const: 'low' } }],
        },
      ],
    };
    const tree = getRuleTree(config);
    expect(tree.fieldToRuleIds['income']).toEqual(expect.arrayContaining(['ruleA', 'ruleB']));
    expect(tree.fieldToRuleIds['income']).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// cycle handling
// ---------------------------------------------------------------------------

describe('getRuleTree - cycle handling', () => {
  const cyclicConfig: FormRuleConfig = {
    rules: [
      {
        id: 'ruleA',
        when: { field: 'fieldB', operator: 'exists' },
        then: [{ action: 'setValue', target: 'fieldA', value: { const: 1 } }],
      },
      {
        id: 'ruleB',
        when: { field: 'fieldA', operator: 'exists' },
        then: [{ action: 'setValue', target: 'fieldB', value: { const: 1 } }],
      },
    ],
  };

  it('does not throw or infinite-loop on a genuine cycle', () => {
    expect(() => getRuleTree(cyclicConfig)).not.toThrow();
  });

  it('adds a warning mentioning "circular"', () => {
    const tree = getRuleTree(cyclicConfig);
    expect(tree.warnings.some((w) => w.toLowerCase().includes('circular'))).toBe(true);
  });

  it('marks a node cyclic: true with empty children somewhere in the tree', () => {
    const tree = getRuleTree(cyclicConfig);

    function findCyclic(nodes: typeof tree.roots): boolean {
      for (const node of nodes) {
        if (node.cyclic === true) {
          expect(node.children).toEqual([]);
          return true;
        }
        if (findCyclic(node.children)) return true;
      }
      return false;
    }

    expect(findCyclic(tree.roots)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// nodesById safety net for pure cycles
// ---------------------------------------------------------------------------

describe('getRuleTree - nodesById safety net', () => {
  it('includes every declared rule id, even a two-rule pure cycle unreachable from any external root', () => {
    const config: FormRuleConfig = {
      rules: [
        {
          id: 'loopA',
          when: { field: 'loopFieldB', operator: 'exists' },
          then: [{ action: 'setValue', target: 'loopFieldA', value: { const: 1 } }],
        },
        {
          id: 'loopB',
          when: { field: 'loopFieldA', operator: 'exists' },
          then: [{ action: 'setValue', target: 'loopFieldB', value: { const: 1 } }],
        },
      ],
    };
    const tree = getRuleTree(config);
    expect(tree.nodesById['loopA']).toBeDefined();
    expect(tree.nodesById['loopB']).toBeDefined();
    expect(Object.keys(tree.nodesById).sort()).toEqual(['loopA', 'loopB']);
  });
});

// ---------------------------------------------------------------------------
// FieldConfigEntry[] input
// ---------------------------------------------------------------------------

describe('getRuleTree - accepts a FieldConfigEntry[] array', () => {
  const flatConfig: FormRuleConfig = {
    rules: [
      {
        id: 'setState',
        when: { field: 'country', operator: 'eq', value: 'US' },
        then: [{ action: 'setValue', target: 'state', value: { const: 'CA' } }],
      },
      {
        id: 'setCounty',
        when: { field: 'state', operator: 'exists' },
        then: [{ action: 'setValue', target: 'county', value: { const: 'Los Angeles' } }],
      },
    ],
  };

  const fieldConfig: FieldConfigEntry[] = [
    {
      jsonattribute: 'state',
      rules: [
        {
          id: 'setState',
          when: { field: 'country', operator: 'eq', value: 'US' },
          action: 'setValue',
          value: { const: 'CA' },
        },
      ],
    },
    {
      jsonattribute: 'county',
      rules: [
        {
          id: 'setCounty',
          when: { field: 'state', operator: 'exists' },
          action: 'setValue',
          value: { const: 'Los Angeles' },
        },
      ],
    },
  ];

  function edgesOf(tree: RuleTreeResult): Array<[string, string]> {
    const edges: Array<[string, string]> = [];
    for (const root of tree.roots) {
      (function walk(node) {
        for (const child of node.children) {
          edges.push([node.ruleId, child.ruleId]);
          walk(child);
        }
      })(root);
    }
    return edges.sort();
  }

  it('produces an equivalent tree structure to the flat config for the same dependency relationship', () => {
    const flatTree = getRuleTree(flatConfig);
    const fieldTree = getRuleTree(fieldConfig);

    expect(Object.keys(fieldTree.nodesById).sort()).toEqual(Object.keys(flatTree.nodesById).sort());
    expect(fieldTree.roots.map((r) => r.ruleId).sort()).toEqual(flatTree.roots.map((r) => r.ruleId).sort());
    expect(edgesOf(fieldTree)).toEqual(edgesOf(flatTree));
  });
});

// ---------------------------------------------------------------------------
// formatRuleTree
// ---------------------------------------------------------------------------

describe('formatRuleTree', () => {
  const config: FormRuleConfig = {
    rules: [
      {
        id: 'setCity',
        when: { field: 'address.zip', operator: 'exists' },
        then: [{ action: 'setValue', target: 'address.city', value: { const: 'Springfield' } }],
      },
      {
        id: 'validateCity',
        when: { field: 'address.city', operator: 'neq', value: '' },
        then: [{ action: 'setValidation', target: 'address.city', validators: { required: true } }],
      },
    ],
  };

  it('returns a string containing every rule id', () => {
    const output = formatRuleTree(config);
    expect(typeof output).toBe('string');
    expect(output).toContain('setCity');
    expect(output).toContain('validateCity');
  });

  it('contains "writes:" followed by the target field for a setValue action', () => {
    const output = formatRuleTree(config);
    expect(output).toContain('writes: address.city');
  });

  it('renders "cyclic ref" for a tree containing a cyclic node', () => {
    const cyclicConfig: FormRuleConfig = {
      rules: [
        {
          id: 'ruleA',
          when: { field: 'fieldB', operator: 'exists' },
          then: [{ action: 'setValue', target: 'fieldA', value: { const: 1 } }],
        },
        {
          id: 'ruleB',
          when: { field: 'fieldA', operator: 'exists' },
          then: [{ action: 'setValue', target: 'fieldB', value: { const: 1 } }],
        },
      ],
    };
    const output = formatRuleTree(cyclicConfig);
    expect(output).toContain('cyclic ref');
  });

  it('produces identical output whether given a raw config or a pre-built RuleTreeResult', () => {
    const rawOutput = formatRuleTree(config);
    const prebuilt = getRuleTree(config);
    const treeOutput = formatRuleTree(prebuilt);
    expect(treeOutput).toBe(rawOutput);
  });
});

// ---------------------------------------------------------------------------
// enabled flag
// ---------------------------------------------------------------------------

describe('getRuleTree - enabled flag', () => {
  it('reflects enabled: false on the node, and formatRuleTree marks it disabled', () => {
    const config: FormRuleConfig = {
      rules: [
        {
          id: 'disabledRule',
          when: { all: [] },
          enabled: false,
          then: [{ action: 'setValue', target: 'someField', value: { const: 1 } }],
        },
      ],
    };
    const tree = getRuleTree(config);
    expect(tree.nodesById['disabledRule'].enabled).toBe(false);

    const output = formatRuleTree(config);
    expect(output).toContain('disabled');
  });
});

// ---------------------------------------------------------------------------
// priority default
// ---------------------------------------------------------------------------

describe('getRuleTree - priority default', () => {
  it('defaults priority to 0 when not specified on a rule', () => {
    const config: FormRuleConfig = {
      rules: [
        {
          id: 'noPriorityRule',
          when: { all: [] },
          then: [{ action: 'setValue', target: 'someField', value: { const: 1 } }],
        },
      ],
    };
    const tree = getRuleTree(config);
    expect(tree.nodesById['noPriorityRule'].priority).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// diamond dependency
// ---------------------------------------------------------------------------

describe('getRuleTree - diamond dependency', () => {
  it('nests the shared descendant under both parents', () => {
    // A writes X; B and C both read X and each write a distinct field;
    // D reads both of those fields.
    const config: FormRuleConfig = {
      rules: [
        {
          id: 'A',
          when: { all: [] },
          then: [{ action: 'setValue', target: 'x', value: { const: 1 } }],
        },
        {
          id: 'B',
          when: { field: 'x', operator: 'exists' },
          then: [{ action: 'setValue', target: 'y1', value: { const: 1 } }],
        },
        {
          id: 'C',
          when: { field: 'x', operator: 'exists' },
          then: [{ action: 'setValue', target: 'y2', value: { const: 1 } }],
        },
        {
          id: 'D',
          when: { all: [{ field: 'y1', operator: 'exists' }, { field: 'y2', operator: 'exists' }] },
          then: [{ action: 'setValue', target: 'z', value: { const: 1 } }],
        },
      ],
    };

    const tree = getRuleTree(config);

    expect(tree.nodesById['D']).toBeDefined();

    const nodeB = tree.nodesById['B'];
    const nodeC = tree.nodesById['C'];
    expect(nodeB.children.some((c) => c.ruleId === 'D')).toBe(true);
    expect(nodeC.children.some((c) => c.ruleId === 'D')).toBe(true);

    // A is the sole root feeding both B and C
    expect(tree.roots.map((r) => r.ruleId)).toEqual(['A']);
  });
});
