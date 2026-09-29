import { compileFieldConfig, fieldConfigToFormRuleConfig, FieldConfigEntry } from '../src/field-config';
import { RuleConfigError } from '../src/form-types';

describe('fieldConfigToFormRuleConfig', () => {
  it('converts each field.rules entry into a FieldRule targeting that field\'s jsonattribute by default', () => {
    const fieldConfig: FieldConfigEntry[] = [
      {
        jsonattribute: 'total',
        label: 'Order total',
        rules: [
          { when: { all: [] }, action: 'setValue', value: { fn: 'add', args: [{ field: 'price' }, { field: 'tax' }] } },
        ],
      },
    ];
    const formConfig = fieldConfigToFormRuleConfig(fieldConfig);
    expect(formConfig.fields).toEqual(['total']);
    expect(formConfig.rules).toHaveLength(1);
    expect(formConfig.rules[0].then[0]).toEqual({
      action: 'setValue',
      target: 'total',
      value: { fn: 'add', args: [{ field: 'price' }, { field: 'tax' }] },
    });
  });

  it('auto-generates a stable rule id when none is given', () => {
    const fieldConfig: FieldConfigEntry[] = [
      { jsonattribute: 'riskTier', rules: [{ when: { all: [] }, action: 'setValue', value: { const: 'high' } }] },
    ];
    const formConfig = fieldConfigToFormRuleConfig(fieldConfig);
    expect(formConfig.rules[0].id).toBe('riskTier__setValue__0');
  });

  it('respects an explicit target override so one field\'s rule can act on another field', () => {
    const fieldConfig: FieldConfigEntry[] = [
      {
        jsonattribute: 'state',
        rules: [{ when: { all: [] }, action: 'resetValue', target: 'city', dependsOn: ['state'] }],
      },
    ];
    const formConfig = fieldConfigToFormRuleConfig(fieldConfig);
    expect(formConfig.rules[0].then[0].target).toBe('city');
    expect(formConfig.rules[0].dependsOn).toEqual(['state']);
  });

  it('leaves extra field metadata untouched (label/type/etc. are not required by the compiler)', () => {
    const fieldConfig: FieldConfigEntry[] = [{ jsonattribute: 'email', label: 'Email', type: 'text', rules: [] }];
    expect(() => fieldConfigToFormRuleConfig(fieldConfig)).not.toThrow();
  });

  it('rejects a field missing jsonattribute', () => {
    const fieldConfig = [{ rules: [{ when: { all: [] }, action: 'setValue', value: { const: 1 } }] }] as unknown as FieldConfigEntry[];
    expect(() => fieldConfigToFormRuleConfig(fieldConfig)).toThrow(RuleConfigError);
  });

  it('rejects a field rule missing "when" or "action"', () => {
    const missingWhen = [{ jsonattribute: 'a', rules: [{ action: 'setValue', value: { const: 1 } }] }] as unknown as FieldConfigEntry[];
    expect(() => fieldConfigToFormRuleConfig(missingWhen)).toThrow(/missing "when"/);

    const missingAction = [{ jsonattribute: 'a', rules: [{ when: { all: [] } }] }] as unknown as FieldConfigEntry[];
    expect(() => fieldConfigToFormRuleConfig(missingAction)).toThrow(/missing "action"/);
  });

  it('rejects a non-array input', () => {
    expect(() => fieldConfigToFormRuleConfig({} as unknown as FieldConfigEntry[])).toThrow(/must be an array/);
  });
});

describe('compileFieldConfig — end-to-end', () => {
  it('compiles and evaluates exactly like the equivalent flat FormRuleConfig, including cascades', () => {
    const fieldConfig: FieldConfigEntry[] = [
      {
        jsonattribute: 'country',
      },
      {
        jsonattribute: 'city',
        rules: [{ when: { all: [] }, action: 'resetValue', dependsOn: ['country'] }],
      },
      {
        jsonattribute: 'localTaxNotice',
        rules: [{ when: { field: 'country', operator: 'eq', value: 'IN' }, action: 'show' }],
      },
    ];
    const engine = compileFieldConfig(fieldConfig);
    const result = engine.evaluate({ country: 'IN', city: 'Delhi' });
    expect(result.patch.localTaxNotice?.visible).toBe(true);
    expect(result.patch.city?.value).toBeNull();
  });

  it('surfaces the same RuleConfigError type as compileFormRules for a bad field rule', () => {
    const fieldConfig = [{ jsonattribute: 'a', rules: [{ when: { all: [] }, action: 'setValidation' }] }] as unknown as FieldConfigEntry[];
    expect(() => compileFieldConfig(fieldConfig)).toThrow(RuleConfigError);
  });
});
