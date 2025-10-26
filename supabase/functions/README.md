# Supabase Edge Functions

This directory contains all Supabase Edge Functions for the project. Each function should live in its own subdirectory with an `index.ts` entrypoint that the deployment pipeline will bundle and upload automatically.

## Shared helpers

Reusable utilities that need to be shared across multiple functions belong in the pre-created [`_shared/`](./_shared) folder. Import them from any edge function using a relative path such as:

```ts
import { handler } from "../_shared/handler";
```

The Dyad app automatically detects updates to files within `_shared/` and redeploys every function so that the shared changes take effect everywhere.
