import {
  compileFormRules,
  getCompiledFormRules,
  buildValidatorFns,
  applyPatchToFormGroup,
  FormRuleConfig,
  RuleConfigError,
  RuleCascadeError,
  RuleEvaluationError,
} from '../src/index';

// ---------------------------------------------------------------------------
// basic actions
// ---------------------------------------------------------------------------

describe('setValue', () => {
  it('sets a value when the condition matches', () => {
    const config: FormRuleConfig = {
      rules: [
        {
          id: 'r1',
          when: { field: 'employmentType', operator: 'eq', value: 'self-employed' },
          then: [{ action: 'setValue', target: 'riskTier', value: { const: 'high' } }],
        },
      ],
    };
    const engine = compileFormRules(config);
    const result = engine.evaluate({ employmentType: 'self-employed' });
    expect(result.patch.riskTier?.value).toBe('high');
  });

  it('does not fire when the condition does not match', () => {
    const config: FormRuleConfig = {
      rules: [
        {
          id: 'r1',
          when: { field: 'employmentType', operator: 'eq', value: 'self-employed' },
          then: [{ action: 'setValue', target: 'riskTier', value: { const: 'high' } }],
        },
      ],
    };
    const engine = compileFormRules(config);
    const result = engine.evaluate({ employmentType: 'salaried' });
    expect(result.patch.riskTier).toBeUndefined();
  });

  it('computes a value via a field + fn expression', () => {
    const config: FormRuleConfig = {
      rules: [
        {
          id: 'r1',
          when: { all: [] },
          then: [
            {
              action: 'setValue',
              target: 'total',
              value: { fn: 'add', args: [{ field: 'price' }, { field: 'tax' }] },
            },
          ],
        },
      ],
    };
    const engine = compileFormRules(config);
    const result = engine.evaluate({ price: 100, tax: 18 });
    expect(result.patch.total?.value).toBe(118);
  });

  it('reads addonData alongside form data', () => {
    const config: FormRuleConfig = {
      rules: [
        {
          id: 'r1',
          when: { all: [] },
          then: [{ action: 'setValue', target: 'discountedPrice', value: { fn: 'sub', args: [{ field: 'price' }, { field: 'promoDiscount' }] } }],
        },
      ],
    };
    const engine = compileFormRules(config);
    const result = engine.evaluate({ price: 100 }, { addonData: { promoDiscount: 10 } });
    expect(result.patch.discountedPrice?.value).toBe(90);
  });

  it('supports an "if" expression reusing the Rule condition grammar', () => {
    const config: FormRuleConfig = {
      rules: [
        {
          id: 'r1',
          when: { all: [] },
          then: [
            {
              action: 'setValue',
              target: 'riskTier',
              value: {
                if: { field: 'income', operator: 'gt', value: 500000 },
                then: { const: 'high' },
                else: { const: 'medium' },
              },
            },
          ],
        },
      ],
    };
    const engine = compileFormRules(config);
    expect(engine.evaluate({ income: 600000 }).patch.riskTier?.value).toBe('high');
    expect(engine.evaluate({ income: 100000 }).patch.riskTier?.value).toBe('medium');
  });

  it('does not overwrite a dirty field unless force is set', () => {
    const config: FormRuleConfig = {
      rules: [
        {
          id: 'r1',
          when: { all: [] },
          then: [{ action: 'setValue', target: 'suggestedName', value: { const: 'Auto Name' } }],
        },
      ],
    };
    const engine = compileFormRules(config);
    const result = engine.evaluate({ suggestedName: 'User Typed' }, { dirtyFields: ['suggestedName'] });
    expect(result.patch.suggestedName).toBeUndefined();
  });

  it('forced setValue overrides a dirty field', () => {
    const config: FormRuleConfig = {
      rules: [
        {
          id: 'r1',
          when: { all: [] },
          then: [{ action: 'setValue', target: 'total', value: { const: 999 }, force: true }],
        },
      ],
    };
    const engine = compileFormRules(config);
    const result = engine.evaluate({ total: 1 }, { dirtyFields: ['total'] });
    expect(result.patch.total?.value).toBe(999);
  });

  it('writes a nested dot-path target without corrupting sibling keys', () => {
    const config: FormRuleConfig = {
      rules: [
        {
          id: 'r1',
          when: { all: [] },
          then: [{ action: 'setValue', target: 'address.city', value: { const: 'Mumbai' } }],
        },
      ],
    };
    const engine = compileFormRules(config);
    const formData = { address: { city: '', zip: '400001' } };
    const result = engine.evaluate(formData);
    // patch is still keyed by the full dot-path string (matches Angular's FormGroup.get('a.b') convention)
    expect(result.patch['address.city']?.value).toBe('Mumbai');
    // the original form data object passed in must never be mutated
    expect(formData.address).toEqual({ city: '', zip: '400001' });
  });

  it('creates missing intermediate objects for a nested dot-path target', () => {
    const config: FormRuleConfig = {
      rules: [
        {
          id: 'r1',
          when: { all: [] },
          then: [{ action: 'setValue', target: 'meta.derived.total', value: { fn: 'add', args: [{ field: 'price' }, { field: 'tax' }] } }],
        },
      ],
    };
    const engine = compileFormRules(config);
    const result = engine.evaluate({ price: 100, tax: 18 });
    expect(result.patch['meta.derived.total']?.value).toBe(118);
  });

  it('cascades correctly when a nested dot-path write feeds a downstream rule reading the same path', () => {
    const config: FormRuleConfig = {
      rules: [
        {
          id: 'setCity',
          when: { field: 'country', operator: 'eq', value: 'IN' },
          then: [{ action: 'setValue', target: 'address.city', value: { const: 'Mumbai' } }],
        },
        {
          id: 'flagCity',
          when: { field: 'address.city', operator: 'eq', value: 'Mumbai' },
          then: [{ action: 'show', target: 'localTaxNotice' }],
        },
      ],
    };
    const engine = compileFormRules(config);
    const result = engine.evaluate({ country: 'IN', address: { city: null } });
    expect(result.patch['address.city']?.value).toBe('Mumbai');
    expect(result.patch.localTaxNotice?.visible).toBe(true);
  });
});

describe('resetValue', () => {
  it('resets a field to null by default, ignoring dirty state', () => {
    const config: FormRuleConfig = {
      rules: [
        {
          id: 'r1',
          when: { field: 'country', operator: 'eq', value: 'IN' },
          then: [{ action: 'resetValue', target: 'state' }],
        },
      ],
    };
    const engine = compileFormRules(config);
    const result = engine.evaluate({ country: 'IN', state: 'CA' }, { dirtyFields: ['state'] });
    expect(result.patch.state?.value).toBeNull();
  });

  it('resets to a computed expression when "to" is given', () => {
    const config: FormRuleConfig = {
      rules: [
        {
          id: 'r1',
          when: { all: [] },
          then: [{ action: 'resetValue', target: 'qty', to: { const: 1 } }],
        },
      ],
    };
    const engine = compileFormRules(config);
    expect(engine.evaluate({ qty: 5 }).patch.qty?.value).toBe(1);
  });
});

describe('setValidation', () => {
  it('applies validators when the condition matches', () => {
    const config: FormRuleConfig = {
      rules: [
        {
          id: 'r1',
          when: { field: 'employmentType', operator: 'eq', value: 'self-employed' },
          then: [{ action: 'setValidation', target: 'itrDocument', validators: { required: true } }],
        },
      ],
    };
    const engine = compileFormRules(config);
    const result = engine.evaluate({ employmentType: 'self-employed' });
    expect(result.patch.itrDocument?.validators).toEqual({ required: true });
  });

  it('merges validators from multiple matching rules on the same target', () => {
    const config: FormRuleConfig = {
      rules: [
        { id: 'r1', when: { all: [] }, then: [{ action: 'setValidation', target: 'amount', validators: { required: true } }] },
        { id: 'r2', when: { all: [] }, then: [{ action: 'setValidation', target: 'amount', validators: { max: 100000 } }] },
      ],
    };
    const engine = compileFormRules(config);
    const result = engine.evaluate({});
    expect(result.patch.amount?.validators).toEqual({ required: true, max: 100000 });
  });

  it('buildValidatorFns produces Angular-shaped ValidatorFns', () => {
    const fns = buildValidatorFns({ required: true, min: 10, max: 20, pattern: '^[a-z]+$' });
    expect(fns.map((f) => f({ value: undefined }))).toContainEqual({ required: true });
    expect(fns.map((f) => f({ value: 5 })).filter(Boolean)).toContainEqual({ min: { min: 10, actual: 5 } });
    expect(fns.map((f) => f({ value: 'ABC' })).filter(Boolean).length).toBeGreaterThan(0);
    expect(fns.every((f) => f({ value: 15 }) === null || typeof f({ value: 15 }) === 'object')).toBe(true);
  });
});

describe('crossFieldValidation', () => {
  it('records an error when the cross-field comparison fails', () => {
    const config: FormRuleConfig = {
      rules: [
        {
          id: 'dateOrder',
          when: { all: [] },
          then: [{ action: 'crossFieldValidation', target: 'endDate', compare: 'gt', otherField: 'startDate', message: 'End date must be after start date' }],
        },
      ],
    };
    const engine = compileFormRules(config);
    const result = engine.evaluate({ startDate: 10, endDate: 5 });
    expect(result.patch.endDate?.crossFieldErrors?.dateOrder).toBe('End date must be after start date');
  });

  it('does not record an error when the comparison passes', () => {
    const config: FormRuleConfig = {
      rules: [
        { id: 'dateOrder', when: { all: [] }, then: [{ action: 'crossFieldValidation', target: 'endDate', compare: 'gt', otherField: 'startDate' }] },
      ],
    };
    const engine = compileFormRules(config);
    const result = engine.evaluate({ startDate: 5, endDate: 10 });
    expect(result.patch.endDate?.crossFieldErrors).toBeUndefined();
  });
});

describe('filterDropdown', () => {
  const cities = [
    { value: 'mumbai', label: 'Mumbai', state: 'MH' },
    { value: 'pune', label: 'Pune', state: 'MH' },
    { value: 'delhi', label: 'Delhi', state: 'DL' },
  ];

  it('filters options by a matching key against a field value', () => {
    const config: FormRuleConfig = {
      rules: [
        {
          id: 'r1',
          when: { field: 'state', operator: 'exists' },
          then: [
            {
              action: 'filterDropdown',
              target: 'city',
              source: { const: cities },
              matchKey: 'state',
              matchValue: { field: 'state' },
            },
          ],
        },
      ],
    };
    const engine = compileFormRules(config);
    const result = engine.evaluate({ state: 'MH' });
    expect(result.patch.city?.options).toEqual([cities[0], cities[1]]);
  });

  it('returns an empty list when nothing matches', () => {
    const config: FormRuleConfig = {
      rules: [
        { id: 'r1', when: { all: [] }, then: [{ action: 'filterDropdown', target: 'city', source: { const: cities }, matchKey: 'state', matchValue: { const: 'TN' } }] },
      ],
    };
    const engine = compileFormRules(config);
    expect(engine.evaluate({}).patch.city?.options).toEqual([]);
  });
});

describe('setOptions', () => {
  it('replaces the full options list', () => {
    const config: FormRuleConfig = {
      rules: [
        {
          id: 'r1',
          when: { all: [] },
          then: [{ action: 'setOptions', target: 'plan', options: { const: [{ value: 'basic' }, { value: 'pro' }] } }],
        },
      ],
    };
    const engine = compileFormRules(config);
    expect(engine.evaluate({}).patch.plan?.options).toEqual([{ value: 'basic' }, { value: 'pro' }]);
  });
});

describe('show/hide and enable/disable', () => {
  it('hide wins over show when both fire for the same target', () => {
    const config: FormRuleConfig = {
      rules: [
        { id: 'showRule', when: { all: [] }, then: [{ action: 'show', target: 'panel' }] },
        { id: 'hideRule', when: { all: [] }, then: [{ action: 'hide', target: 'panel' }] },
      ],
    };
    const engine = compileFormRules(config);
    expect(engine.evaluate({}).patch.panel?.visible).toBe(false);
  });

  it('disable wins over enable when both fire for the same target', () => {
    const config: FormRuleConfig = {
      rules: [
        { id: 'enableRule', when: { all: [] }, then: [{ action: 'enable', target: 'field' }] },
        { id: 'disableRule', when: { all: [] }, then: [{ action: 'disable', target: 'field' }] },
      ],
    };
    const engine = compileFormRules(config);
    expect(engine.evaluate({}).patch.field?.disabled).toBe(true);
  });

  it('shows a field when only a show rule fires', () => {
    const config: FormRuleConfig = {
      rules: [{ id: 'r1', when: { all: [] }, then: [{ action: 'show', target: 'panel' }] }],
    };
    const engine = compileFormRules(config);
    expect(engine.evaluate({}).patch.panel?.visible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// cascade / dependency graph
// ---------------------------------------------------------------------------

describe('cascade evaluation', () => {
  const countryStateCity: FormRuleConfig = {
    rules: [
      {
        id: 'filterStates',
        when: { field: 'country', operator: 'exists' },
        then: [{ action: 'filterDropdown', target: 'state', source: { field: 'allStates' }, matchKey: 'country', matchValue: { field: 'country' } }],
      },
      {
        id: 'filterCities',
        when: { field: 'state', operator: 'exists' },
        then: [{ action: 'filterDropdown', target: 'city', source: { field: 'allCities' }, matchKey: 'state', matchValue: { field: 'state' } }],
      },
      {
        id: 'resetStateOnCountryChange',
        when: { field: 'country', operator: 'exists' },
        then: [{ action: 'resetValue', target: 'state' }],
      },
      {
        id: 'resetCityOnStateChange',
        // Intentionally value-independent: city must reset even when state was
        // just cleared to null by resetStateOnCountryChange above, so `when`
        // can't be a condition on state's value — dependsOn wires up the link.
        when: { all: [] },
        dependsOn: ['state'],
        then: [{ action: 'resetValue', target: 'city' }],
      },
    ],
  };

  const allStates = [
    { value: 'MH', label: 'Maharashtra', country: 'IN' },
    { value: 'CA', label: 'California', country: 'US' },
  ];
  const allCities = [
    { value: 'pune', label: 'Pune', state: 'MH' },
    { value: 'la', label: 'LA', state: 'CA' },
  ];

  it('cascades a country change through state reset -> city reset, several hops deep', () => {
    const engine = compileFormRules(countryStateCity);
    const result = engine.evaluate(
      { country: 'IN', state: 'CA', city: 'la', allStates, allCities },
      { changedFields: ['country'] }
    );
    // country change -> resets state to null AND filters the state dropdown;
    // state becoming null then cascades -> resets city to null AND filters city dropdown.
    expect(result.patch.state?.value).toBeNull();
    expect(result.patch.city?.value).toBeNull();
    expect(result.passes).toBeGreaterThanOrEqual(2);
  });

  it('full mode evaluates every rule once on initial load without a seed field', () => {
    const engine = compileFormRules(countryStateCity);
    const result = engine.evaluate({ country: 'IN', state: 'MH', city: 'pune', allStates, allCities });
    expect(result.patch.state?.options).toEqual([allStates[0]]);
    expect(result.patch.city?.options).toEqual([allCities[0]]);
  });

  it('a rule with zero field dependencies still fires on a full pass', () => {
    const config: FormRuleConfig = {
      rules: [{ id: 'alwaysOn', when: { all: [] }, then: [{ action: 'setValue', target: 'flag', value: { const: true } }] }],
    };
    const engine = compileFormRules(config);
    expect(engine.evaluate({}).patch.flag?.value).toBe(true);
  });

  it('only re-evaluates rules reachable from the changed field, not the whole rule set', () => {
    const unrelated = jest.fn(() => true);
    const config: FormRuleConfig = {
      rules: [
        { id: 'a', when: { field: 'x', operator: 'exists' }, then: [{ action: 'setValue', target: 'y', value: { fn: 'add', args: [{ field: 'x' }, { const: 1 }] } }] },
        { id: 'b', when: { field: 'unrelatedField', operator: 'exists' }, then: [{ action: 'setValue', target: 'z', value: { const: 'touched' } }] },
      ],
    };
    const engine = compileFormRules(config);
    const result = engine.evaluate({ x: 1, unrelatedField: 'present' }, { changedFields: ['x'], explain: true });
    const touchedRuleB = result.trace?.some((t) => t.ruleId === 'b');
    expect(touchedRuleB).toBe(false);
    expect(result.patch.y?.value).toBe(2);
    expect(result.patch.z).toBeUndefined();
    unrelated();
  });
});

// ---------------------------------------------------------------------------
// cycle / infinite-loop protection
// ---------------------------------------------------------------------------

describe('cycle protection', () => {
  it('throws RuleCascadeError instead of looping forever on a genuine oscillating cycle', () => {
    const config: FormRuleConfig = {
      rules: [
        {
          id: 'aSetsB',
          when: { field: 'a', operator: 'exists' },
          then: [{ action: 'setValue', target: 'b', value: { fn: 'add', args: [{ field: 'a' }, { const: 1 }] } }],
        },
        {
          id: 'bSetsA',
          when: { field: 'b', operator: 'exists' },
          then: [{ action: 'setValue', target: 'a', value: { fn: 'add', args: [{ field: 'b' }, { const: 1 }] } }],
        },
      ],
    };
    const engine = compileFormRules(config);
    expect(() => engine.evaluate({ a: 0, b: 0 }, { changedFields: ['a'], maxCascadeDepth: 10 })).toThrow(RuleCascadeError);
  });

  it('static compile-time analysis surfaces a warning for a likely cycle', () => {
    const config: FormRuleConfig = {
      rules: [
        { id: 'aSetsB', when: { field: 'a', operator: 'exists' }, then: [{ action: 'setValue', target: 'b', value: { const: 1 } }] },
        { id: 'bSetsA', when: { field: 'b', operator: 'exists' }, then: [{ action: 'setValue', target: 'a', value: { const: 1 } }] },
      ],
    };
    const engine = compileFormRules(config);
    expect(engine.warnings.some((w) => w.includes('circular'))).toBe(true);
  });

  it('a rule that keeps setting the SAME value does not cascade forever (fixpoint reached)', () => {
    const config: FormRuleConfig = {
      rules: [
        { id: 'selfStable', when: { field: 'a', operator: 'exists' }, then: [{ action: 'setValue', target: 'a', value: { field: 'a' } }] },
      ],
    };
    const engine = compileFormRules(config);
    const result = engine.evaluate({ a: 5 }, { changedFields: ['a'] });
    expect(result.passes).toBe(1);
  });

  it('does not throw for a long but finite, non-cyclical chain within maxCascadeDepth', () => {
    // country -> state -> city -> tax -> total (4 hops), well under the default cap
    const config: FormRuleConfig = {
      rules: [
        { id: 'r1', when: { field: 'country', operator: 'exists' }, then: [{ action: 'resetValue', target: 'state', to: { const: 'X' } }] },
        { id: 'r2', when: { field: 'state', operator: 'exists' }, then: [{ action: 'resetValue', target: 'city', to: { const: 'Y' } }] },
        { id: 'r3', when: { field: 'city', operator: 'exists' }, then: [{ action: 'setValue', target: 'tax', value: { const: 10 } }] },
        { id: 'r4', when: { field: 'tax', operator: 'exists' }, then: [{ action: 'setValue', target: 'total', value: { fn: 'add', args: [{ field: 'tax' }, { const: 100 }] } }] },
      ],
    };
    const engine = compileFormRules(config);
    const result = engine.evaluate({ country: 'IN', state: 'old', city: 'old', tax: 0, total: 0 }, { changedFields: ['country'] });
    expect(result.patch.total?.value).toBe(110);
  });
});

// ---------------------------------------------------------------------------
// config validation / error messages
// ---------------------------------------------------------------------------

describe('config validation', () => {
  it('rejects a config with a duplicate rule id', () => {
    const config = {
      rules: [
        { id: 'dup', when: { all: [] }, then: [{ action: 'setValue', target: 'a', value: { const: 1 } }] },
        { id: 'dup', when: { all: [] }, then: [{ action: 'setValue', target: 'b', value: { const: 2 } }] },
      ],
    } as unknown as FormRuleConfig;
    expect(() => compileFormRules(config)).toThrow(RuleConfigError);
    expect(() => compileFormRules(config)).toThrow(/duplicate rule id/);
  });

  it('rejects an unknown action type', () => {
    const config = {
      rules: [{ id: 'r1', when: { all: [] }, then: [{ action: 'doSomethingWeird', target: 'a' }] }],
    } as unknown as FormRuleConfig;
    expect(() => compileFormRules(config)).toThrow(/unknown or malformed action/);
  });

  it('rejects an action missing a target', () => {
    const config = {
      rules: [{ id: 'r1', when: { all: [] }, then: [{ action: 'setValue', value: { const: 1 } }] }],
    } as unknown as FormRuleConfig;
    expect(() => compileFormRules(config)).toThrow(/missing a non-empty "target"/);
  });

  it('rejects a malformed value expression', () => {
    const config = {
      rules: [{ id: 'r1', when: { all: [] }, then: [{ action: 'setValue', target: 'a', value: { nonsense: true } }] }],
    } as unknown as FormRuleConfig;
    expect(() => compileFormRules(config)).toThrow(/unrecognized expression shape/);
  });

  it('rejects filterDropdown missing matchKey', () => {
    const config = {
      rules: [{ id: 'r1', when: { all: [] }, then: [{ action: 'filterDropdown', target: 'city', source: { const: [] }, matchValue: { const: 1 } }] }],
    } as unknown as FormRuleConfig;
    expect(() => compileFormRules(config)).toThrow(/requires a non-empty "matchKey"/);
  });

  it('rejects a rule with no id', () => {
    const config = { rules: [{ when: { all: [] }, then: [{ action: 'setValue', target: 'a', value: { const: 1 } }] }] } as unknown as FormRuleConfig;
    expect(() => compileFormRules(config)).toThrow(/needs a non-empty string "id"/);
  });

  it('rejects a config whose "rules" is missing entirely', () => {
    expect(() => compileFormRules({} as unknown as FormRuleConfig)).toThrow(/config.rules must be an array/);
  });

  it('rejects a rule with an empty "then" array', () => {
    const config = { rules: [{ id: 'r1', when: { all: [] }, then: [] }] } as unknown as FormRuleConfig;
    expect(() => compileFormRules(config)).toThrow(/non-empty array of actions/);
  });

  it('rejects crossFieldValidation missing otherField', () => {
    const config = {
      rules: [{ id: 'r1', when: { all: [] }, then: [{ action: 'crossFieldValidation', target: 'end', compare: 'gt' }] }],
    } as unknown as FormRuleConfig;
    expect(() => compileFormRules(config)).toThrow(/requires a non-empty "otherField"/);
  });

  it('rejects setValidation missing a validators object', () => {
    const config = {
      rules: [{ id: 'r1', when: { all: [] }, then: [{ action: 'setValidation', target: 'a' }] }],
    } as unknown as FormRuleConfig;
    expect(() => compileFormRules(config)).toThrow(/requires a "validators" object/);
  });

  it('rejects an "if" expression missing then/else', () => {
    const config = {
      rules: [{ id: 'r1', when: { all: [] }, then: [{ action: 'setValue', target: 'a', value: { if: { all: [] } } }] }],
    } as unknown as FormRuleConfig;
    expect(() => compileFormRules(config)).toThrow(/missing "then"\/"else"/);
  });

  it('rejects an expression.field that is an empty string', () => {
    const config = {
      rules: [{ id: 'r1', when: { all: [] }, then: [{ action: 'setValue', target: 'a', value: { field: '' } }] }],
    } as unknown as FormRuleConfig;
    expect(() => compileFormRules(config)).toThrow(/field must be a non-empty string/);
  });

  it('wraps an unknown expression fn name in a clear runtime error', () => {
    const config: FormRuleConfig = {
      rules: [{ id: 'r1', when: { all: [] }, then: [{ action: 'setValue', target: 'a', value: { fn: 'notARealFunction', args: [] } }] }],
    };
    const engine = compileFormRules(config);
    expect(() => engine.evaluate({})).toThrow(RuleEvaluationError);
    expect(() => engine.evaluate({})).toThrow(/rule "r1"/);
  });

  it('rejects an object expression whose "object" is not a plain object', () => {
    const config = {
      rules: [{ id: 'r1', when: { all: [] }, then: [{ action: 'setValue', target: 'a', value: { object: 'not-an-object' } }] }],
    } as unknown as FormRuleConfig;
    expect(() => compileFormRules(config)).toThrow(/expression.object must be a plain object/);
  });

  it('rejects a malformed sub-expression nested inside an object expression', () => {
    const config = {
      rules: [{ id: 'r1', when: { all: [] }, then: [{ action: 'setValue', target: 'a', value: { object: { bad: {} } } }] }],
    } as unknown as FormRuleConfig;
    expect(() => compileFormRules(config)).toThrow(/unrecognized expression shape/);
  });
});

describe('setValue with an object expression (end-to-end)', () => {
  it('sets a whole computed sub-object on one field in a single rule', () => {
    const config: FormRuleConfig = {
      rules: [
        {
          id: 'buildSummary',
          when: { all: [] },
          then: [
            {
              action: 'setValue',
              target: 'summary',
              value: {
                object: {
                  total: { fn: 'add', args: [{ field: 'price' }, { field: 'tax' }] },
                  itemCount: { field: 'itemCount' },
                },
              },
            },
          ],
        },
      ],
    };
    const engine = compileFormRules(config);
    const result = engine.evaluate({ price: 100, tax: 18, itemCount: 3 });
    expect(result.patch.summary?.value).toEqual({ total: 118, itemCount: 3 });
  });
});

// ---------------------------------------------------------------------------
// priority / conflict resolution
// ---------------------------------------------------------------------------

describe('priority-based conflict resolution', () => {
  it('a higher-priority rule wins over a lower-priority rule for the same setValue target', () => {
    const config: FormRuleConfig = {
      rules: [
        { id: 'low', when: { all: [] }, then: [{ action: 'setValue', target: 'tier', value: { const: 'low-tier' } }], priority: 1 },
        { id: 'high', when: { all: [] }, then: [{ action: 'setValue', target: 'tier', value: { const: 'high-tier' } }], priority: 10 },
      ],
    };
    const engine = compileFormRules(config);
    expect(engine.evaluate({}).patch.tier?.value).toBe('high-tier');
  });

  it('falls back to declaration order when priorities tie', () => {
    const config: FormRuleConfig = {
      rules: [
        { id: 'first', when: { all: [] }, then: [{ action: 'setValue', target: 'tier', value: { const: 'first' } }] },
        { id: 'second', when: { all: [] }, then: [{ action: 'setValue', target: 'tier', value: { const: 'second' } }] },
      ],
    };
    const engine = compileFormRules(config);
    expect(engine.evaluate({}).patch.tier?.value).toBe('second');
  });
});

describe('disabled rules', () => {
  it('skips a rule with enabled: false', () => {
    const config: FormRuleConfig = {
      rules: [{ id: 'r1', enabled: false, when: { all: [] }, then: [{ action: 'setValue', target: 'a', value: { const: 1 } }] }],
    };
    const engine = compileFormRules(config);
    expect(engine.evaluate({}).patch.a).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// compile caching
// ---------------------------------------------------------------------------

describe('getCompiledFormRules caching', () => {
  it('returns the same compiled instance for the same config object', () => {
    const config: FormRuleConfig = { rules: [{ id: 'r1', when: { all: [] }, then: [{ action: 'setValue', target: 'a', value: { const: 1 } }] }] };
    const first = getCompiledFormRules(config);
    const second = getCompiledFormRules(config);
    expect(first).toBe(second);
  });

  it('compiles independently for a different config object', () => {
    const configA: FormRuleConfig = { rules: [{ id: 'r1', when: { all: [] }, then: [{ action: 'setValue', target: 'a', value: { const: 1 } }] }] };
    const configB: FormRuleConfig = { rules: [{ id: 'r1', when: { all: [] }, then: [{ action: 'setValue', target: 'a', value: { const: 2 } }] }] };
    expect(getCompiledFormRules(configA)).not.toBe(getCompiledFormRules(configB));
  });
});

// ---------------------------------------------------------------------------
// explain / trace mode
// ---------------------------------------------------------------------------

describe('explain mode', () => {
  it('reports which rules matched and which did not', () => {
    const config: FormRuleConfig = {
      rules: [
        { id: 'matches', when: { field: 'x', operator: 'eq', value: 1 }, then: [{ action: 'setValue', target: 'y', value: { const: 1 } }] },
        { id: 'noMatch', when: { field: 'x', operator: 'eq', value: 2 }, then: [{ action: 'setValue', target: 'z', value: { const: 1 } }] },
      ],
    };
    const engine = compileFormRules(config);
    const result = engine.evaluate({ x: 1 }, { explain: true });
    const matchesEntry = result.trace?.find((t) => t.ruleId === 'matches');
    const noMatchEntry = result.trace?.find((t) => t.ruleId === 'noMatch');
    expect(matchesEntry?.matched).toBe(true);
    expect(noMatchEntry?.matched).toBe(false);
  });

  it('omits trace when explain is not requested', () => {
    const config: FormRuleConfig = { rules: [{ id: 'r1', when: { all: [] }, then: [{ action: 'setValue', target: 'a', value: { const: 1 } }] }] };
    const engine = compileFormRules(config);
    expect(engine.evaluate({}).trace).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// custom expression functions & custom validators
// ---------------------------------------------------------------------------

describe('custom expression functions', () => {
  it('supports an extra fn passed via options.fns', () => {
    const config: FormRuleConfig = {
      rules: [{ id: 'r1', when: { all: [] }, then: [{ action: 'setValue', target: 'shout', value: { fn: 'shout', args: [{ field: 'name' }] } }] }],
    };
    const engine = compileFormRules(config);
    const result = engine.evaluate({ name: 'tejas' }, { fns: { shout: (a) => `${String(a).toUpperCase()}!` } });
    expect(result.patch.shout?.value).toBe('TEJAS!');
  });
});

describe('custom validators', () => {
  it('buildValidatorFns runs a named custom validator', () => {
    const fns = buildValidatorFns({ custom: 'isEven' }, { isEven: (v) => typeof v === 'number' && v % 2 === 0 });
    expect(fns[0]({ value: 3 })).toEqual({ isEven: true });
    expect(fns[0]({ value: 4 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// applyPatchToFormGroup (Angular convenience, duck-typed)
// ---------------------------------------------------------------------------

describe('applyPatchToFormGroup', () => {
  function makeFakeControl() {
    return {
      value: undefined as unknown,
      errors: null as Record<string, unknown> | null,
      setValue: jest.fn(function (this: any, v: unknown) {
        this.value = v;
      }),
      setValidators: jest.fn(),
      setErrors: jest.fn(function (this: any, e: Record<string, unknown> | null) {
        this.errors = e;
      }),
      updateValueAndValidity: jest.fn(),
      disable: jest.fn(),
      enable: jest.fn(),
    };
  }

  it('applies value, validators, disabled state, and cross-field errors to matching controls', () => {
    const amountControl = makeFakeControl();
    const endDateControl = makeFakeControl();
    const formGroup = {
      get: (name: string) => (name === 'amount' ? amountControl : name === 'endDate' ? endDateControl : null),
    };

    applyPatchToFormGroup(formGroup, {
      amount: { value: 500, validators: { required: true }, disabled: true },
      endDate: { crossFieldErrors: { r1: 'must be after start' } },
    });

    expect(amountControl.setValue).toHaveBeenCalledWith(500, { emitEvent: false });
    expect(amountControl.setValidators).toHaveBeenCalled();
    expect(amountControl.disable).toHaveBeenCalled();
    expect(endDateControl.setErrors).toHaveBeenCalledWith({ crossField: { r1: 'must be after start' } });
  });

  it('silently skips patch entries for controls that do not exist on the form', () => {
    const formGroup = { get: () => null };
    expect(() => applyPatchToFormGroup(formGroup, { ghost: { value: 1 } })).not.toThrow();
  });
});
