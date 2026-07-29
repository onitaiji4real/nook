# Database

Prisma schema, migrations, repository implementations, and database test helpers.

## Source layout

- `src/index.ts` is the package's only public entrypoint.
- `src/<feature>/` owns repositories for the matching API/domain feature.
- Consumers import from `@nook/database`; feature files are internal implementation details.
- `prisma/` owns the schema and forward-only migrations. Application startup never applies them.

Do not add repository implementations directly under `src`. Add them to an existing cohesive feature
directory, or create a new feature directory and export the supported surface from `src/index.ts`.
