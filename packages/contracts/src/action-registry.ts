import type { Result } from "better-result";
import type { ValidationError, SignetError } from "@xmtp/signet-schemas";
import {
  ACTION_SURFACES,
  type ActionSpec,
  type ActionSurface,
} from "./action-spec.js";
import { validateActionSpecs } from "./action-validate.js";

/**
 * Base type that any ActionSpec satisfies, regardless of its
 * input/output type parameters. Used for heterogeneous storage
 * in the registry where we only need access to id, input schema,
 * and surface metadata — not the strongly-typed handler signature.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyActionSpec = ActionSpec<any, any, SignetError>;

/**
 * Registry for ActionSpec instances. Transport adapters query the
 * registry at startup to discover actions they should expose.
 */
export interface ActionRegistry {
  /**
   * Register an ActionSpec. Throws if an action with the same id
   * is already registered (fail-fast for duplicate registrations).
   *
   * Accepts any ActionSpec regardless of its input/output type
   * parameters, avoiding variance issues with contravariant handler
   * inputs.
   */
  register(spec: AnyActionSpec): void;

  /** Look up an ActionSpec by id. Returns undefined if not found. */
  lookup(id: string): AnyActionSpec | undefined;

  /** List all registered ActionSpecs. */
  list(): readonly AnyActionSpec[];

  /**
   * List ActionSpecs that have a specific surface.
   * Convenience for transport adapters.
   */
  listForSurface(surface: ActionSurface): readonly AnyActionSpec[];

  /** Validate the current registry contents. */
  validate(): Result<void, ValidationError>;

  /** Number of registered actions. */
  readonly size: number;
}

/**
 * Create an ActionRegistry instance.
 * The registry is an in-memory Map. No persistence, no async.
 */
export function createActionRegistry(): ActionRegistry {
  const specs = new Map<string, AnyActionSpec>();

  return {
    register(spec) {
      if (specs.has(spec.id)) {
        throw new Error(`Action '${spec.id}' is already registered`);
      }
      const validation = validateActionSpecs([...specs.values(), spec]);
      if (validation.isErr()) {
        throw validation.error;
      }
      specs.set(spec.id, spec);
    },

    lookup(id) {
      return specs.get(id);
    },

    list() {
      return [...specs.values()];
    },

    listForSurface(surface) {
      if (!ACTION_SURFACES.includes(surface)) {
        return [];
      }

      return [...specs.values()].filter((spec) => spec[surface] != null);
    },

    validate() {
      return validateActionSpecs([...specs.values()]);
    },

    get size() {
      return specs.size;
    },
  };
}
