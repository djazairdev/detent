# Rules

The engineering rules for this repository, for people and for coding agents
working on it. `readRules()` also gives this file to every session Detent
launches when it runs on its own code. New here? Read
[CONTRIBUTING.md](CONTRIBUTING.md) first; it says how to start, and
[docs/architecture.md](docs/architecture.md) says where things are.

Rules marked **[lint]** are enforced by `npm run lint`. Seven more are enforced
by `npm run rules:check` — grab-bag filenames, TODO markers without an issue number,
`console.*` in `src/`, empty catches with no stated why, `.only`/`.skip`,
`node:` prefixes, and `.js` specifiers. The rest need a reader, and the checker
names them rather than implying a green run means full compliance. When a rule
here collides with the PRD or the implementation plan, the PRD wins and this
file gets fixed. You don't need to read the PRD to contribute: the issue you
pick says where to start, and [docs/architecture.md](docs/architecture.md) maps the code.

## Files

- **≤ 300 code lines per `src/` file; ≤ 600 per test file** — counted with
  blank lines and comments skipped. **[lint: `max-lines`]** Split by
  responsibility when approaching the ceiling, never mechanically: a cohesive
  concern that cannot fit in 300 lines is a design smell to fix, not a number
  to dodge.
- One module, one job. Name files after the thing they own (`escrow`, not
  `utils`). No `helpers.ts`/`utils.ts` grab-bags in `src/`.
- No default exports; named exports only. **[lint]**

## Comments

- **No `//` comments, anywhere in a `.ts` file.** Documentation is a `/** … */`
  doc-block on the declaration it describes; a rare standalone `/* … */` may
  state an in-body why the code cannot (an empty catch, a deliberate no-op).
  Compiler/lint directives (`@ts-expect-error`, `eslint-…`) are the one escape
  — TypeScript only honors them in line form.
  **[lint: `detent/no-line-comments`, `no-inline-comments`]**
- No narration. A comment that restates what the next line does is deleted on
  sight; the fix for unclear code is clearer code.
- Comments state what the code cannot: the constraint, the invariant, the
  deliberate deviation — and cite the requirement that demands it
  (`C-9`, `ARCH-1`, `D-27`, or the issue, `#123`). This repo's doc-blocks are
  load-bearing: the parity map requires the ported oracle tests to cite their
  closing ticket, and the audit tests quote requirement ids. Older comments
  cite PRDR ids; those records are in git history
  ([`tickets/prd-review/`](https://github.com/djazairdev/detent/tree/f0fe15c3163ed22c52ba7237a82fd8f03ab9d6f0/tickets/prd-review)). Keep writing them; keep them at
  block level (`/** … */` above the declaration).
- `TODO` names the issue that will close it (`#123`) or it does not merge.

## Language

- Modern TypeScript, strict. The compiler options are law:
  `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` — never
  weaken them, never `@ts-ignore`/`@ts-expect-error` around them in `src/`.
- ESM only, NodeNext resolution, `node:`-prefixed builtins, explicit `.js`
  specifiers on relative imports.
- `const` by default; `let` only when reassignment is the point; never `var`.
  **[lint: `prefer-const`, `no-var`]**
- Use the modern operators where they say it better: `?.`, `??`, spread,
  destructuring, template literals **[lint: `prefer-template`]**, object
  shorthand **[lint: `object-shorthand`]**, `at(-1)` over `arr[arr.length-1]`.
- `===`/`!==` always (null-checks may use `== null`). **[lint: `eqeqeq`]**
- `async`/`await` over `.then` chains; arrow functions for callbacks.
  **[lint: `prefer-arrow-callback`]**
- No `enum` — union types of string literals carry the same meaning with zero
  runtime and honest JSON. **[lint]**
- No `any` in `src/`; model unknown data as `unknown` and parse it through a
  zod schema at the boundary (`schemas/**` is the vocabulary — reuse it).
- Type-only imports are marked as such (`import type { X }`, or
  `import { fn, type X }`). **[lint: `consistent-type-imports`]**
- Public data shapes are `readonly`; interfaces over type aliases for object
  contracts; discriminated unions over boolean flags.

## Errors

- Typed error classes with a `name`, thrown once, mapped at the boundary —
  never stringly-typed control flow. A structured error a caller must route is
  part of the contract; document its codes.
- An empty `catch` carries a block comment saying why swallowing is correct.
- No `console.*` in `src/`; user-facing text flows through the caller's
  `print`/`note`/`announce` seams.

## Architecture (a reminder, enforced elsewhere)

- ARCH-1's import zones and the apply-site audit are the boundary's law:
  drivers never touch `machine.apply`, event constructors, or event names;
  layers below the kernel never import mutators. The lint zones and
  `tests/arch/**` enforce this — do not loosen either to make a change fit.
- Determinism everywhere the referee stands: no `Date.now()`/randomness in
  decision paths without an injectable seam (`now?: () => number`).

## Tests

- Tests before code where an oracle exists. A test for a bug names the issue
  it fixes (`#123`); the ported oracle tests cite their ticket, which the parity
  map checks.
- One behavior per test; fixtures over mocks where the real thing is cheap
  (real git repos, real gate scripts).
- `.only`/`.skip` never merge; a skip that must stay names its issue (`#123`).
