import test from "node:test";
import assert from "node:assert/strict";
import type { Request, RequestHandler, Response } from "express";
import multer from "multer";

import { guardUpload } from "./upload-guard";

function makeRes(): { res: Response; status(): number | undefined; body(): unknown } {
  let statusCode: number | undefined;
  let jsonBody: unknown;
  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(body: unknown) {
      jsonBody = body;
      return res;
    },
  } as unknown as Response;
  return { res, status: () => statusCode, body: () => jsonBody };
}

function run(uploader: RequestHandler): { status(): number | undefined; body(): unknown; nextCalled(): boolean } {
  const { res, status, body } = makeRes();
  let nextCalled = false;
  guardUpload(uploader)({} as Request, res, () => {
    nextCalled = true;
  });
  return { status, body, nextCalled: () => nextCalled };
}

test("guardUpload maps LIMIT_FILE_SIZE to 413", () => {
  const tooBig: RequestHandler = (_req, _res, next) =>
    next(new multer.MulterError("LIMIT_FILE_SIZE", "image"));
  const { status, body, nextCalled } = run(tooBig);
  assert.equal(status(), 413);
  assert.equal(nextCalled(), false);
  assert.match((body() as { message: string }).message, /file too large/i);
});

test("guardUpload maps fileFilter rejections to 400", () => {
  const badType: RequestHandler = (_req, _res, next) =>
    next(new Error("Only PNG, JPEG, GIF, or WEBP images are allowed"));
  const { status, body, nextCalled } = run(badType);
  assert.equal(status(), 400);
  assert.equal(nextCalled(), false);
  assert.equal((body() as { message: string }).message, "Only PNG, JPEG, GIF, or WEBP images are allowed");
});

test("guardUpload maps other multer errors to 400", () => {
  const unexpected: RequestHandler = (_req, _res, next) =>
    next(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "image"));
  const { status } = run(unexpected);
  assert.equal(status(), 400);
});

test("guardUpload passes through on success", () => {
  const ok: RequestHandler = (_req, _res, next) => next();
  const { status, nextCalled } = run(ok);
  assert.equal(status(), undefined);
  assert.equal(nextCalled(), true);
});
