import { describe, expect, it } from "bun:test";
import {
  ErrorCategory,
  ERROR_CATEGORY_META,
  errorCategoryMeta,
  ValidationError,
  SealError,
  NotFoundError,
  PermissionError,
  GrantDeniedError,
  AuthError,
  SessionExpiredError,
  InternalError,
  TimeoutError,
  CancelledError,
  NetworkError,
  matchError,
} from "../errors/index.js";
import type { AnySignetError } from "../errors/index.js";

describe("ErrorCategory", () => {
  it("accepts all 8 categories", () => {
    for (const c of [
      "validation",
      "not_found",
      "permission",
      "auth",
      "internal",
      "timeout",
      "cancelled",
      "network",
    ]) {
      expect(ErrorCategory.safeParse(c).success).toBe(true);
    }
  });

  it("rejects invalid category", () => {
    expect(ErrorCategory.safeParse("unknown").success).toBe(false);
  });
});

describe("ERROR_CATEGORY_META", () => {
  it("has entries for all 8 categories", () => {
    const categories = ErrorCategory.options;
    for (const c of categories) {
      const meta = ERROR_CATEGORY_META[c];
      expect(meta).toBeDefined();
      expect(typeof meta.exitCode).toBe("number");
      expect(typeof meta.statusCode).toBe("number");
      expect(typeof meta.jsonRpcCode).toBe("number");
      expect(typeof meta.retryable).toBe("boolean");
    }
  });

  it("maps validation to correct codes", () => {
    const meta = ERROR_CATEGORY_META.validation;
    expect(meta.exitCode).toBe(1);
    expect(meta.statusCode).toBe(400);
    expect(meta.jsonRpcCode).toBe(-32602);
    expect(meta.retryable).toBe(false);
  });

  it("marks only timeout and network as retryable", () => {
    const categories = ErrorCategory.options;
    for (const c of categories) {
      expect(ERROR_CATEGORY_META[c].retryable).toBe(
        c === "timeout" || c === "network",
      );
    }
  });

  it("maps network to exit code 6 and HTTP 503", () => {
    const meta = ERROR_CATEGORY_META.network;
    expect(meta.exitCode).toBe(6);
    expect(meta.statusCode).toBe(503);
    expect(meta.jsonRpcCode).toBe(-32002);
    expect(meta.retryable).toBe(true);
  });

  it("maps cancelled to exit code 130 and HTTP 499", () => {
    const meta = ERROR_CATEGORY_META.cancelled;
    expect(meta.exitCode).toBe(130);
    expect(meta.statusCode).toBe(499);
  });
});

describe("errorCategoryMeta", () => {
  it("returns the same object as direct lookup", () => {
    expect(errorCategoryMeta("auth")).toBe(ERROR_CATEGORY_META.auth);
  });
});

describe("ValidationError", () => {
  it("creates with correct properties", () => {
    const err = ValidationError.create("email", "invalid format");
    expect(err._tag).toBe("ValidationError");
    expect(err.code).toBe(1000);
    expect(err.category).toBe("validation");
    expect(err.context.field).toBe("email");
    expect(err.context.reason).toBe("invalid format");
    expect(err.message).toBe("Validation failed on 'email': invalid format");
  });

  it("includes extra context", () => {
    const err = ValidationError.create("age", "too low", {
      min: 18,
    });
    expect(err.context.min).toBe(18);
  });

  it("is an instance of Error", () => {
    expect(ValidationError.create("f", "r")).toBeInstanceOf(Error);
  });
});

describe("SealError", () => {
  it("creates with correct properties", () => {
    const err = SealError.create("att-1", "expired");
    expect(err._tag).toBe("SealError");
    expect(err.code).toBe(1010);
    expect(err.category).toBe("validation");
    expect(err.context.sealId).toBe("att-1");
    expect(err.message).toBe("Seal 'att-1': expired");
  });

  it("is an instance of Error", () => {
    expect(SealError.create("att-1", "expired")).toBeInstanceOf(Error);
  });
});

describe("NotFoundError", () => {
  it("creates with correct properties", () => {
    const err = NotFoundError.create("Session", "sess-42");
    expect(err._tag).toBe("NotFoundError");
    expect(err.code).toBe(1100);
    expect(err.category).toBe("not_found");
    expect(err.context.resourceType).toBe("Session");
    expect(err.context.resourceId).toBe("sess-42");
    expect(err.message).toBe("Session 'sess-42' not found");
  });
});

describe("PermissionError", () => {
  it("creates with null context by default", () => {
    const err = PermissionError.create("Access denied");
    expect(err._tag).toBe("PermissionError");
    expect(err.code).toBe(1200);
    expect(err.category).toBe("permission");
    expect(err.context).toBeNull();
  });

  it("creates with provided context", () => {
    const err = PermissionError.create("Denied", { scope: "admin" });
    expect(err.context).toEqual({ scope: "admin" });
  });
});

describe("GrantDeniedError", () => {
  it("creates with correct properties", () => {
    const err = GrantDeniedError.create("send", "messaging");
    expect(err._tag).toBe("GrantDeniedError");
    expect(err.code).toBe(1210);
    expect(err.category).toBe("permission");
    expect(err.context.operation).toBe("send");
    expect(err.context.grantType).toBe("messaging");
    expect(err.message).toBe(
      "Operation 'send' denied: missing messaging grant",
    );
  });
});

describe("AuthError", () => {
  it("creates with null context by default", () => {
    const err = AuthError.create("Unauthorized");
    expect(err._tag).toBe("AuthError");
    expect(err.code).toBe(1300);
    expect(err.category).toBe("auth");
    expect(err.context).toBeNull();
  });
});

describe("SessionExpiredError", () => {
  it("creates with correct properties", () => {
    const err = SessionExpiredError.create("sess-99");
    expect(err._tag).toBe("SessionExpiredError");
    expect(err.code).toBe(1310);
    expect(err.category).toBe("auth");
    expect(err.context.sessionId).toBe("sess-99");
    expect(err.message).toBe("Session 'sess-99' has expired");
  });
});

describe("InternalError", () => {
  it("creates with null context by default", () => {
    const err = InternalError.create("Invariant violated");
    expect(err._tag).toBe("InternalError");
    expect(err.code).toBe(1400);
    expect(err.category).toBe("internal");
    expect(err.context).toBeNull();
  });
});

describe("TimeoutError", () => {
  it("creates with correct properties", () => {
    const err = TimeoutError.create("fetchMessages", 5000);
    expect(err._tag).toBe("TimeoutError");
    expect(err.code).toBe(1500);
    expect(err.category).toBe("timeout");
    expect(err.context.operation).toBe("fetchMessages");
    expect(err.context.timeoutMs).toBe(5000);
    expect(err.message).toBe(
      "Operation 'fetchMessages' timed out after 5000ms",
    );
  });
});

describe("CancelledError", () => {
  it("creates with null context", () => {
    const err = CancelledError.create("User cancelled");
    expect(err._tag).toBe("CancelledError");
    expect(err.code).toBe(1600);
    expect(err.category).toBe("cancelled");
    expect(err.context).toBeNull();
  });
});

describe("NetworkError", () => {
  it("creates with correct properties", () => {
    const err = NetworkError.create(
      "xmtp://node.example.com",
      "connection refused",
    );
    expect(err._tag).toBe("NetworkError");
    expect(err.code).toBe(1700);
    expect(err.category).toBe("network");
    expect(err.context.endpoint).toBe("xmtp://node.example.com");
    expect(err.message).toBe(
      "Network error reaching 'xmtp://node.example.com': connection refused",
    );
  });

  it("includes extra context", () => {
    const err = NetworkError.create("api.example.com", "timeout", {
      attemptNumber: 3,
    });
    expect(err.context.endpoint).toBe("api.example.com");
    expect(err.context.attemptNumber).toBe(3);
  });

  it("is an instance of Error", () => {
    expect(NetworkError.create("ep", "reason")).toBeInstanceOf(Error);
  });
});

describe("matchError", () => {
  it("dispatches to correct handler by _tag", () => {
    const err: AnySignetError = GrantDeniedError.create("send", "messaging");
    const result = matchError(err, {
      ValidationError: () => "validation",
      SealError: () => "seal",
      NotFoundError: () => "not_found",
      PermissionError: () => "permission",
      GrantDeniedError: (e) => `denied:${e.context.operation}`,
      AuthError: () => "auth",
      SessionExpiredError: () => "session_expired",
      InternalError: () => "internal",
      TimeoutError: () => "timeout",
      CancelledError: () => "cancelled",
      NetworkError: () => "network",
    });
    expect(result).toBe("denied:send");
  });

  it("handles every error class", () => {
    const errors: AnySignetError[] = [
      ValidationError.create("f", "r"),
      SealError.create("a", "r"),
      NotFoundError.create("T", "id"),
      PermissionError.create("msg"),
      GrantDeniedError.create("op", "gt"),
      AuthError.create("msg"),
      SessionExpiredError.create("s"),
      InternalError.create("msg"),
      TimeoutError.create("op", 1000),
      CancelledError.create("msg"),
      NetworkError.create("ep", "reason"),
    ];

    for (const err of errors) {
      const result = matchError(err, {
        ValidationError: () => "ValidationError",
        SealError: () => "SealError",
        NotFoundError: () => "NotFoundError",
        PermissionError: () => "PermissionError",
        GrantDeniedError: () => "GrantDeniedError",
        AuthError: () => "AuthError",
        SessionExpiredError: () => "SessionExpiredError",
        InternalError: () => "InternalError",
        TimeoutError: () => "TimeoutError",
        CancelledError: () => "CancelledError",
        NetworkError: () => "NetworkError",
      });
      expect(result).toBe(err._tag);
    }
  });
});
