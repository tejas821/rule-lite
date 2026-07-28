import { RuleEngine, evaluate, getByPath, Rule } from '../src/index';

describe('getByPath', () => {
  it('resolves nested dot paths', () => {
    expect(getByPath({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42);
  });

  it('returns undefined for missing paths', () => {
    expect(getByPath({ a: {} }, 'a.b.c')).toBeUndefined();
    expect(getByPath(null, 'a.b')).toBeUndefined();
  });

  it('returns the object itself for an empty path', () => {
    const obj = { a: 1 };
    expect(getByPath(obj, '')).toBe(obj);
  });
});

describe('RuleEngine — leaf conditions', () => {
  const engine = new RuleEngine();

  it('eq / neq', () => {
    expect(engine.evaluate({ field: 'status', operator: 'eq', value: 'active' }, { status: 'active' })).toBe(true);
    expect(engine.evaluate({ field: 'status', operator: 'neq', value: 'active' }, { status: 'active' })).toBe(false);
  });

  it('numeric comparisons', () => {
    const ctx = { age: 21 };
    expect(engine.evaluate({ field: 'age', operator: 'gt', value: 18 }, ctx)).toBe(true);
    expect(engine.evaluate({ field: 'age', operator: 'gte', value: 21 }, ctx)).toBe(true);
    expect(engine.evaluate({ field: 'age', operator: 'lt', value: 18 }, ctx)).toBe(false);
    expect(engine.evaluate({ field: 'age', operator: 'lte', value: 21 }, ctx)).toBe(true);
  });

  it('in / notIn', () => {
    const ctx = { country: 'IN' };
    expect(engine.evaluate({ field: 'country', operator: 'in', value: ['IN', 'US'] }, ctx)).toBe(true);
    expect(engine.evaluate({ field: 'country', operator: 'notIn', value: ['US', 'UK'] }, ctx)).toBe(true);
  });

  it('contains for strings and arrays', () => {
    expect(engine.evaluate({ field: 'name', operator: 'contains', value: 'ejas' }, { name: 'Tejas' })).toBe(true);
    expect(engine.evaluate({ field: 'tags', operator: 'contains', value: 'admin' }, { tags: ['user', 'admin'] })).toBe(true);
  });

  it('startsWith / endsWith', () => {
    const ctx = { email: 'tejas@example.com' };
    expect(engine.evaluate({ field: 'email', operator: 'startsWith', value: 'tejas' }, ctx)).toBe(true);
    expect(engine.evaluate({ field: 'email', operator: 'endsWith', value: '.com' }, ctx)).toBe(true);
  });

  it('exists / notExists / truthy / falsy', () => {
    expect(engine.evaluate({ field: 'missing', operator: 'exists' }, {})).toBe(false);
    expect(engine.evaluate({ field: 'missing', operator: 'notExists' }, {})).toBe(true);
    expect(engine.evaluate({ field: 'flag', operator: 'truthy' }, { flag: 1 })).toBe(true);
    expect(engine.evaluate({ field: 'flag', operator: 'falsy' }, { flag: 0 })).toBe(true);
  });

  it('resolves nested field paths from context', () => {
    const ctx = { user: { address: { country: 'IN' } } };
    expect(engine.evaluate({ field: 'user.address.country', operator: 'eq', value: 'IN' }, ctx)).toBe(true);
  });

  it('throws on unknown operator', () => {
    expect(() =>
      engine.evaluate({ field: 'x', operator: 'bogus' } as unknown as Rule, {})
    ).toThrow(/unknown operator/);
  });
});

describe('RuleEngine — composite rules', () => {
  const engine = new RuleEngine();
  const ctx = { age: 25, country: 'IN', role: 'admin' };

  it('all (AND)', () => {
    const rule: Rule = {
      all: [
        { field: 'age', operator: 'gte', value: 18 },
        { field: 'country', operator: 'eq', value: 'IN' },
      ],
    };
    expect(engine.evaluate(rule, ctx)).toBe(true);
  });

  it('any (OR)', () => {
    const rule: Rule = {
      any: [
        { field: 'role', operator: 'eq', value: 'superadmin' },
        { field: 'role', operator: 'eq', value: 'admin' },
      ],
    };
    expect(engine.evaluate(rule, ctx)).toBe(true);
  });

  it('not', () => {
    const rule: Rule = { not: { field: 'role', operator: 'eq', value: 'guest' } };
    expect(engine.evaluate(rule, ctx)).toBe(true);
  });

  it('nested composites', () => {
    const rule: Rule = {
      all: [
        { field: 'age', operator: 'gte', value: 18 },
        {
          any: [
            { field: 'country', operator: 'eq', value: 'US' },
            { not: { field: 'role', operator: 'eq', value: 'guest' } },
          ],
        },
      ],
    };
    expect(engine.evaluate(rule, ctx)).toBe(true);
  });
});

describe('custom operators', () => {
  it('supports registering a custom operator', () => {
    const engine = new RuleEngine({
      operators: {
        divisibleBy: (a, b) => typeof a === 'number' && typeof b === 'number' && a % b === 0,
      },
    });
    expect(engine.evaluate({ field: 'n', operator: 'divisibleBy', value: 5 }, { n: 25 })).toBe(true);
    expect(engine.evaluate({ field: 'n', operator: 'divisibleBy', value: 5 }, { n: 26 })).toBe(false);
  });

  it('supports registerOperator after construction', () => {
    const engine = new RuleEngine();
    engine.registerOperator('isEven', (a) => typeof a === 'number' && a % 2 === 0);
    expect(engine.evaluate({ field: 'n', operator: 'isEven' }, { n: 4 })).toBe(true);
  });
});

describe('standalone evaluate()', () => {
  it('evaluates without instantiating RuleEngine manually', () => {
    expect(evaluate({ field: 'x', operator: 'eq', value: 1 }, { x: 1 })).toBe(true);
  });
});
