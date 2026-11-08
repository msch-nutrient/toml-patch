import { parse, patch } from '../index';
import diff from '../diff';
import { stableStringify } from '../utils';

// The rename matcher uses a stable value representation. Dates must not collide
// with strings containing their ISO text: a rename would preserve the wrong type.
for (const literal of [
  '1979-05-27',
  '07:32:00',
  '1979-05-27T07:32:00',
  '1979-05-27T07:32:00Z'
]) {
  for (const temporal of [false, true]) {
    describe(`${literal} (${temporal ? 'Temporal' : 'Date'})`, () => {
      const date = parse(`value = ${literal}`, { temporal }).value;
      const text = temporal ? date.toString() : date.toISOString();

      test('compares a date differently from its ISO string, including inside containers', () => {
        expect(stableStringify(date)).not.toBe(stableStringify(text));
        expect(stableStringify({ when: date })).not.toBe(stableStringify({ when: text }));
        expect(stableStringify([{ when: date }])).not.toBe(stableStringify([{ when: text }]));
      });

      test('still infers a rename for equal dates', () => {
        const copy = parse(`value = ${literal}`, { temporal }).value;
        expect(diff({ holder: { when: date } }, { renamed: { when: copy } })).toEqual([
          { type: 'Rename', path: [], from: 'holder', to: 'renamed' }
        ]);
      });

      test('preserves the date literal and comments when the value really is unchanged', () => {
        const source = `holder = { when = ${literal} } # keep\n`;
        const updated = { renamed: { when: date } };
        const result = patch(source, updated);

        expect(result).toBe(`renamed = { when = ${literal} } # keep\n`);
        expect(parse(result, { temporal })).toEqual(updated);
      });

      for (const direction of ['date to string', 'string to date']) {
        const from = direction === 'date to string' ? date : text;
        const to = direction === 'date to string' ? text : date;
        const beforeLiteral = direction === 'date to string' ? literal : JSON.stringify(text);
        const afterLiteral = direction === 'date to string' ? JSON.stringify(text) : literal;

        test(`does not infer a rename for ${direction}`, () => {
          expect(diff({ holder: { when: from } }, { renamed: { when: to } })).toEqual([
            { type: 'Remove', path: ['holder'] },
            { type: 'Add', path: ['renamed'] }
          ]);
        });

        for (const shape of ['scalar', 'table', 'array']) {
          const wrap = (value: any) => shape === 'scalar' ? value
            : shape === 'table' ? { when: value } : [{ when: value }];
          const wrapLiteral = (value: string) => shape === 'scalar' ? value
            : shape === 'table' ? `{ when = ${value} }` : `[{ when = ${value} }]`;

          test(`applies ${direction} inside a ${shape} without renaming the key`, () => {
            const source = `[scope]\nholder = ${wrapLiteral(beforeLiteral)} # keep\n`;
            const updated = { scope: { holder: wrap(to) } };
            const result = patch(source, updated);

            expect(result).toBe(`[scope]\nholder = ${wrapLiteral(afterLiteral)} # keep\n`);
            expect(parse(result, { temporal })).toEqual(updated);
          });

          test(`applies ${direction} when renaming a ${shape}-valued row`, () => {
            const source = `[scope]\nholder = ${wrapLiteral(beforeLiteral)}\n`;
            const updated = { scope: { renamed: wrap(to) } };
            const result = patch(source, updated);
            const expectedLiteral = shape === 'array' ? `[{when = ${afterLiteral}}]` : wrapLiteral(afterLiteral);

            expect(result).toBe(`[scope]\nrenamed = ${expectedLiteral}\n`);
            expect(parse(result, { temporal })).toEqual(updated);
          });

          for (const inline of [false, true]) {
            test(`applies ${direction} when renaming a root ${shape}-valued row (${inline ? 'inline' : 'default'})`, () => {
              const source = `holder = ${wrapLiteral(beforeLiteral)}\n`;
              const updated = { renamed: wrap(to) };
              const result = patch(source, updated, inline ? { inlineTableStart: 0 } : undefined);
              const expectedLiteral = shape === 'array' ? `[{when = ${afterLiteral}}]` : wrapLiteral(afterLiteral);
              const expected = inline || shape === 'scalar' ? `renamed = ${expectedLiteral}\n`
                : shape === 'table' ? `[renamed]\nwhen = ${afterLiteral}\n`
                : `[[renamed]]\nwhen = ${afterLiteral}\n`;

              expect(result).toBe(expected);
              expect(parse(result, { temporal })).toEqual(updated);
            });
          }
        }
      }
    });
  }
}

test('date and string elements remain distinct when an array is reordered', () => {
  const source = 'values = [1979-05-27, "1979-05-27"]\n';
  const original = parse(source);
  const updated = { values: [original.values[1], original.values[0]] };
  const result = patch(source, updated);

  expect(result).toBe('values = ["1979-05-27", 1979-05-27]\n');
  expect(parse(result)).toEqual(updated);
});

test.each([false, true])('adds every generated table-array entry when values changed (updateOrder: %s)', updateOrder => {
  const source = 'holder = [{ when = 1979-05-27 }]\nkeep = 1\n\n[tail]\nx = 3\n';
  const updated = {
    keep: 1,
    renamed: [{ when: '1979-05-27' }, { when: '1980-01-01' }],
    tail: { x: 3 }
  };
  const result = patch(source, updated, { updateOrder });
  const entries = '[[renamed]]\nwhen = "1979-05-27"\n\n[[renamed]]\nwhen = "1980-01-01"\n';
  const tail = '[tail]\nx = 3\n';

  expect(result).toBe('keep = 1\n\n' + (updateOrder ? entries + '\n' + tail : tail + '\n' + entries));
  expect(parse(result)).toEqual(updated);
});

test('adds a new root array of tables through the same indexed-add path', () => {
  const source = 'keep = 1\n';
  const updated = { keep: 1, rows: [{ a: 1 }, { a: 2 }] };
  const result = patch(source, updated);

  expect(result).toBe('keep = 1\n\n[[rows]]\na = 1\n\n[[rows]]\na = 2\n');
  expect(parse(result)).toEqual(updated);
});

test('keeps matching Date and Temporal representations equal', () => {
  const source = 'value = 1979-05-27';
  const date = parse(source).value;
  const temporal = parse(source, { temporal: true }).value;

  expect(stableStringify(date)).toBe(stableStringify(temporal));
});
