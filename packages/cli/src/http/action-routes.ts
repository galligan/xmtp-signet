import { Result } from "better-result";
import type {
  ActionRegistry,
  ActionSpec,
  HttpInputSource,
  HttpMethod,
} from "@xmtp/signet-contracts";
import {
  deriveHttpInputSource,
  deriveHttpMethod,
  deriveHttpPath,
} from "@xmtp/signet-contracts";
import type { ValidationError, SignetError } from "@xmtp/signet-schemas";

/** A derived HTTP action route exposed by the Signet HTTP server. */
export interface HttpActionRoute {
  readonly actionId: string;
  readonly auth: "admin" | "credential";
  readonly inputSource: HttpInputSource;
  readonly method: HttpMethod;
  readonly path: string;
  readonly spec: ActionSpec<unknown, unknown, SignetError>;
}

const isHttpExposed = (
  spec: ActionSpec<unknown, unknown, SignetError>,
): boolean => spec.http !== undefined && spec.http.expose !== false;

/**
 * Build derived HTTP action routes from the shared action registry.
 *
 * The registry is validated before projection so route errors fail during
 * startup/build rather than at request time.
 */
export function buildHttpActionRoutes(
  registry: ActionRegistry,
): Result<readonly HttpActionRoute[], ValidationError> {
  const validation = registry.validate();
  if (validation.isErr()) {
    return validation;
  }

  return Result.ok(
    registry
      .listForSurface("http")
      .filter(isHttpExposed)
      .map((spec) => {
        const method = deriveHttpMethod(spec);
        return {
          actionId: spec.id,
          auth: spec.http!.auth,
          inputSource: deriveHttpInputSource(method),
          method,
          path: deriveHttpPath(spec),
          spec,
        } satisfies HttpActionRoute;
      }),
  );
}

/** Find a derived action route for an incoming HTTP method/path pair. */
export function matchHttpActionRoute(
  routes: readonly HttpActionRoute[],
  method: string,
  path: string,
): HttpActionRoute | undefined {
  return routes.find((route) => route.method === method && route.path === path);
}
