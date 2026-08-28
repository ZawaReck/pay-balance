# Repository Guidelines

## Project Structure & Module Organization

This repository is currently an empty project scaffold. As implementation is added, keep production code under `src/`, tests under `tests/`, and static resources under `assets/`. Put project documentation in `docs/` and keep configuration files at the repository root when required by the relevant tool.

Organize source files by feature or domain rather than by file type. For example, use `src/payments/` for payment-related behavior and place closely related helpers beside the feature that owns them. Avoid committing generated output, dependency caches, editor metadata, or secrets.

## Build, Test, and Development Commands

No build system, package manager, or test runner is configured yet. When introducing one, provide a small, stable command set and document it in the root `README.md`. Prefer conventional commands such as:

- `npm run dev` — start the local development environment.
- `npm test` — run the complete automated test suite.
- `npm run lint` — check formatting and static-analysis rules.
- `npm run build` — produce a release-ready build.

Do not document a command until its supporting configuration is committed and the command succeeds from the repository root.

## Coding Style & Naming Conventions

Use the formatter and linter standard for the chosen language, committed with reproducible configuration. Until language-specific rules exist, use spaces rather than tabs, UTF-8 files, and a final newline. Choose descriptive names: `camelCase` for variables and functions, `PascalCase` for types or components, and `kebab-case` for general filenames. Keep functions focused and comments limited to intent that the code cannot express clearly.

## Testing Guidelines

Add tests with every behavior change and bug fix. Mirror the source structure under `tests/`, using names such as `payment-balance.test.ts` or the ecosystem equivalent. Cover normal paths, boundary cases, and failure handling. Any future coverage threshold must be enforced in continuous integration rather than stated only in documentation.

## Commit & Pull Request Guidelines

There is no Git history from which to infer an existing convention. Use concise, imperative commit subjects, optionally following Conventional Commits (for example, `feat: add balance calculation` or `fix: reject negative payments`). Keep commits narrowly scoped.

Pull requests should explain the problem and solution, list verification performed, link relevant issues, and call out configuration or migration changes. Include screenshots for visible UI changes. Before requesting review, run all configured formatting, linting, testing, and build checks.
