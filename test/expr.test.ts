import { evaluateExpression, collectExpressionFields, collectRuleFields, defaultExprFns, ValueExpression } from '../src/expr';
import { RuleEngine } from '../src/core';

const engine = new RuleEngine();
const evalRule = (rule: any, ctx: any) => engine.evaluate(rule, ctx);

describe('evaluateExpression — built-in fns', () => {
  it('add / sub / mul / div / mod', () => {
    expect(evaluateExpression({ fn: 'add', args: [{ const: 2 }, { const: 3 }, { const: 4 }] }, {}, evalRule)).toBe(9);
    expect(evaluateExpression({ fn: 'sub', args: [{ const: 10 }, { const: 4 }] }, {}, evalRule)).toBe(6);
    expect(evaluateExpression({ fn: 'mul', args: [{ const: 3 }, { const: 4 }] }, {}, evalRule)).toBe(12);
    expect(evaluateExpression({ fn: 'div', args: [{ const: 10 }, { const: 4 }] }, {}, evalRule)).toBe(2.5);
    expect(evaluateExpression({ fn: 'mod', args: [{ const: 10 }, { const: 3 }] }, {}, evalRule)).toBe(1);
  });

  it('concat and coalesce', () => {
    expect(evaluateExpression({ fn: 'concat', args: [{ const: 'a' }, { const: 1 }, { const: null }] }, {}, evalRule)).toBe('a1');
    expect(evaluateExpression({ fn: 'coalesce', args: [{ const: null }, { const: undefined }, { const: 'fallback' }] }, {}, evalRule)).toBe('fallback');
  });

  it('min / max / round', () => {
    expect(evaluateExpression({ fn: 'min', args: [{ const: 5 }, { const: 2 }, { const: 8 }] }, {}, evalRule)).toBe(2);
    expect(evaluateExpression({ fn: 'max', args: [{ const: 5 }, { const: 2 }, { const: 8 }] }, {}, evalRule)).toBe(8);
    expect(evaluateExpression({ fn: 'round', args: [{ const: 3.14159 }, { const: 2 }] }, {}, evalRule)).toBe(3.14);
  });

  it('len / upper / lower', () => {
    expect(evaluateExpression({ fn: 'len', args: [{ const: 'hello' } as ValueExpression] }, {}, evalRule)).toBe(5);
    expect(evaluateExpression({ fn: 'len', args: [{ const: null }] }, {}, evalRule)).toBe(0);
    expect(evaluateExpression({ fn: 'upper', args: [{ const: 'abc' }] }, {}, evalRule)).toBe('ABC');
    expect(evaluateExpression({ fn: 'lower', args: [{ const: 'ABC' }] }, {}, evalRule)).toBe('abc');
  });

  it('field reads a nested dot path from context', () => {
    expect(evaluateExpression({ field: 'a.b.c' }, { a: { b: { c: 42 } } }, evalRule)).toBe(42);
  });

  it('if evaluates then/else based on a Rule condition', () => {
    const expr: ValueExpression = { if: { field: 'age', operator: 'gte', value: 18 }, then: { const: 'adult' }, else: { const: 'minor' } };
    expect(evaluateExpression(expr, { age: 20 }, evalRule)).toBe('adult');
    expect(evaluateExpression(expr, { age: 10 }, evalRule)).toBe('minor');
  });

  it('throws a clear error for an unknown fn name', () => {
    expect(() => evaluateExpression({ fn: 'notReal', args: [] }, {}, evalRule)).toThrow(/unknown expression function/);
  });

  it('toNumber / toString / toBoolean coerce values arriving as strings from form controls', () => {
    expect(evaluateExpression({ fn: 'toNumber', args: [{ const: '42' }] }, {}, evalRule)).toBe(42);
    expect(evaluateExpression({ fn: 'toNumber', args: [{ const: '' }] }, {}, evalRule)).toBeNull();
    expect(evaluateExpression({ fn: 'toNumber', args: [{ const: 'not a number' }] }, {}, evalRule)).toBeNull();
    expect(evaluateExpression({ fn: 'toNumber', args: [{ const: 7 }] }, {}, evalRule)).toBe(7);

    expect(evaluateExpression({ fn: 'toString', args: [{ const: 42 }] }, {}, evalRule)).toBe('42');
    expect(evaluateExpression({ fn: 'toString', args: [{ const: null }] }, {}, evalRule)).toBe('');

    expect(evaluateExpression({ fn: 'toBoolean', args: [{ const: 'false' }] }, {}, evalRule)).toBe(false);
    expect(evaluateExpression({ fn: 'toBoolean', args: [{ const: '0' }] }, {}, evalRule)).toBe(false);
    expect(evaluateExpression({ fn: 'toBoolean', args: [{ const: 'yes' }] }, {}, evalRule)).toBe(true);
    expect(evaluateExpression({ fn: 'toBoolean', args: [{ const: 1 }] }, {}, evalRule)).toBe(true);
  });

  it('toNumber lets add() work correctly on string-typed form values (key1 = key2 + key3)', () => {
    const expr: ValueExpression = {
      fn: 'add',
      args: [{ fn: 'toNumber', args: [{ field: 'key2' }] }, { fn: 'toNumber', args: [{ field: 'key3' }] }],
    };
    expect(evaluateExpression(expr, { key2: '10', key3: '5' }, evalRule)).toBe(15);
  });

  it('object composes a new JSON object from a map of sub-expressions in one evaluation', () => {
    const expr: ValueExpression = {
      object: {
        total: { fn: 'add', args: [{ field: 'price' }, { field: 'tax' }] },
        label: { fn: 'concat', args: [{ const: 'Order #' }, { field: 'orderId' }] },
        nested: { object: { flag: { const: true } } },
      },
    };
    expect(evaluateExpression(expr, { price: 100, tax: 18, orderId: 7 }, evalRule)).toEqual({
      total: 118,
      label: 'Order #7',
      nested: { flag: true },
    });
  });

  it('throws a clear error for a malformed expression', () => {
    expect(() => evaluateExpression({ nonsense: true } as unknown as ValueExpression, {}, evalRule)).toThrow(/malformed value expression/);
    expect(() => evaluateExpression(null as unknown as ValueExpression, {}, evalRule)).toThrow(/malformed value expression/);
  });

  it('supports an override fn registry via options.fns', () => {
    const result = evaluateExpression({ fn: 'double', args: [{ const: 21 }] }, {}, evalRule, { fns: { double: (a) => (a as number) * 2 } });
    expect(result).toBe(42);
  });
});

describe('collectExpressionFields', () => {
  it('collects field refs from nested fn args', () => {
    const out = collectExpressionFields({ fn: 'add', args: [{ field: 'a' }, { fn: 'sub', args: [{ field: 'b' }, { const: 1 }] }] });
    expect([...out].sort()).toEqual(['a', 'b']);
  });

  it('collects field refs from an if/then/else, including the condition', () => {
    const out = collectExpressionFields({
      if: { field: 'country', operator: 'eq', value: 'IN' },
      then: { field: 'inrPrice' },
      else: { field: 'usdPrice' },
    });
    expect([...out].sort()).toEqual(['country', 'inrPrice', 'usdPrice']);
  });

  it('a const expression has no field dependencies', () => {
    expect(collectExpressionFields({ const: 42 }).size).toBe(0);
  });

  it('collects field refs from every value in an object expression, including nested objects', () => {
    const out = collectExpressionFields({
      object: {
        total: { fn: 'add', args: [{ field: 'price' }, { field: 'tax' }] },
        nested: { object: { flag: { field: 'isActive' } } },
      },
    });
    expect([...out].sort()).toEqual(['isActive', 'price', 'tax']);
  });
});

describe('collectRuleFields', () => {
  it('collects fields across all/any/not composites', () => {
    const out = collectRuleFields({
      all: [
        { field: 'a', operator: 'eq', value: 1 },
        { any: [{ field: 'b', operator: 'eq', value: 1 }, { not: { field: 'c', operator: 'eq', value: 1 } }] },
      ],
    });
    expect([...out].sort()).toEqual(['a', 'b', 'c']);
  });

  it('an always-true empty "all" rule has no field dependencies', () => {
    expect(collectRuleFields({ all: [] }).size).toBe(0);
  });
});

describe('defaultExprFns registry', () => {
  it('exposes the documented function names', () => {
    expect(Object.keys(defaultExprFns).sort()).toEqual(
      [
        'add', 'coalesce', 'concat', 'div', 'len', 'lower', 'max', 'min', 'mod', 'mul', 'round', 'sub', 'upper',
        'toNumber', 'toString', 'toBoolean',
      ].sort()
    );
  });
});
