import { describe, expect, test } from "bun:test";
import {
  issueSessionToken,
  maskCookie,
  SESSION_TTL_MS,
  verifySessionToken,
} from "../../src/server/auth";

describe("server / auth", () => {
  test("token emitido verifica com a senha correta", () => {
    const token = issueSessionToken("senha");
    expect(verifySessionToken(token, "senha")).toBe(true);
    expect(verifySessionToken(token, "outra")).toBe(false);
  });

  test("token ausente/inválido rejeitado", () => {
    expect(verifySessionToken(undefined, "senha")).toBe(false);
    expect(verifySessionToken("", "senha")).toBe(false);
    expect(verifySessionToken("lixo", "senha")).toBe(false);
    expect(verifySessionToken("abc.def", "senha")).toBe(false);
  });

  test("token expirado rejeitado", () => {
    const now = 1_000_000;
    const token = issueSessionToken("senha", now);
    expect(verifySessionToken(token, "senha", now + SESSION_TTL_MS - 1)).toBe(
      true,
    );
    expect(verifySessionToken(token, "senha", now + SESSION_TTL_MS + 1)).toBe(
      false,
    );
  });

  test("adulteração da assinatura rejeitada", () => {
    const token = issueSessionToken("senha");
    const [expires] = token.split(".");
    expect(verifySessionToken(`${expires}.deadbeef`, "senha")).toBe(false);
  });

  test("maskCookie não vaza valor", () => {
    expect(maskCookie("JSESSIONID=abc")).toBe("••••••••");
    expect(maskCookie("  ")).toBe("");
  });
});
