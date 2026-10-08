
import type { NextFunction, Request, Response } from "express";

function statusOf(err: unknown): number {
  if (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof err.status === "number"
  ) {
    return err.status;
  }

  return 500;
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  const status = statusOf(err);

  // Never log req.body because it may contain passwords.
  console.error({
    method: req.method,
    path: req.path,
    status,
    err,
  });

  res.status(status).json({
    error: status >= 500 ? "Internal server error" : "Invalid request",
  });
}
